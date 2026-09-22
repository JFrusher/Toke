'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  type Autosave,
  clearRecovery,
  createAutosave,
  loadRecovery,
  markCleanExit,
  needsRecovery,
} from '@/engine/persistence/autosave';
import { downloadProject, projectNameFrom, readProjectFile } from '@/engine/persistence/fileIo';
import { DEFAULT_RECORD_SOURCE, fromProject, toProject } from '@/engine/persistence/project';
import { packProject, unpackProject } from '@/engine/persistence/tokeFile';
import { useCanvasStore } from '@/engine/store/useCanvasStore';
import { useDataStore } from '@/engine/store/useDataStore';
import { reportDiagnostic } from '@/engine/store/useDiagnosticsStore';
import { points } from '@/engine/units/types';
import type { AppError } from '@/lib/errors';
import { isErr } from '@/lib/result';

const DEFAULT_NAME = 'Untitled';

export function FileMenu() {
  const [name, setName] = useState(DEFAULT_NAME);
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<AppError | null>(null);
  const [recoverable, setRecoverable] = useState(false);
  const [busy, setBusy] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const autosaveRef = useRef<Autosave | null>(null);

  /** Snapshot of everything that belongs in a .toke file. */
  const buildBytes = useCallback(async () => {
    const canvas = useCanvasStore.getState();
    const data = useDataStore.getState();

    const project = toProject({
      name,
      nodes: canvas.nodes,
      artboard: { width: canvas.artboard.width, height: canvas.artboard.height },
      recordSource: DEFAULT_RECORD_SOURCE,
      database: await data.exportDatabase(),
      assets: [],
      fonts: [],
    });

    const packed = await packProject(project);
    if (isErr(packed)) throw new Error(packed.error.message);
    return packed.value;
  }, [name]);

  // ---- autosave ----------------------------------------------------------
  useEffect(() => {
    const autosave = createAutosave({
      produce: async () => ({
        name,
        savedAt: new Date().toISOString(),
        payload: await buildBytes(),
      }),
      onError: (error) => {
        setProblem(error);
        reportDiagnostic('autosave', 'error', error);
      },
    });
    autosaveRef.current = autosave;

    // Every scene change restarts the debounce. Subscribing to the store
    // rather than to React state keeps this out of the render path.
    const unsubscribe = useCanvasStore.subscribe((state, previous) => {
      if (state.nodes === previous.nodes) return;
      setDirty(true);
      autosave.schedule();
    });

    // A hidden tab may never come back. Flush rather than wait out the
    // debounce and lose the last edit.
    const onHide = () => {
      if (document.visibilityState === 'hidden') void autosave.flush();
    };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onHide);
      autosave.dispose();
      autosaveRef.current = null;
    };
  }, [buildBytes, name]);

  // ---- crash recovery ----------------------------------------------------
  useEffect(() => {
    void needsRecovery().then(setRecoverable);
  }, []);

  async function recover() {
    setBusy(true);
    const snapshot = await loadRecovery();
    setBusy(false);

    if (isErr(snapshot)) {
      setProblem(snapshot.error);
      setRecoverable(false);
      return;
    }
    await applyBytes(snapshot.value.payload, snapshot.value.name);
    setRecoverable(false);
  }

  async function applyBytes(bytes: Uint8Array, fallbackName: string) {
    const project = await unpackProject(bytes);
    if (isErr(project)) {
      setProblem(project.error);
      return;
    }

    const applied = fromProject(project.value);
    useCanvasStore.getState().loadScene(applied.nodes, {
      x: 0,
      y: 0,
      width: points(applied.artboard.width),
      height: points(applied.artboard.height),
    });
    await useDataStore.getState().loadDatabase(applied.database);

    setName(applied.name === '' ? fallbackName : applied.name);
    setProblem(null);
    setDirty(false);
  }

  async function save() {
    setBusy(true);
    try {
      const bytes = await buildBytes();
      downloadProject(bytes, name);
      // Only now is the work safely off the machine; recovery can stand down.
      await markCleanExit();
      setDirty(false);
    } catch (error) {
      const failure = {
        code: 'TOKE_WRITE_FAILED',
        message: error instanceof Error ? error.message : 'Could not save the project.',
      } as const;
      setProblem(failure);
      reportDiagnostic('project', 'error', failure);
    } finally {
      setBusy(false);
    }
  }

  async function open(file: File | undefined) {
    if (file === undefined) return;
    setBusy(true);
    await applyBytes(await readProjectFile(file), projectNameFrom(file.name));
    setBusy(false);
  }

  return (
    <>
      <div className="flex items-center gap-1.5">
        <input
          aria-label="Project name"
          data-testid="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-7 w-40 rounded-[2px] border border-border-control bg-panel-raised px-1.5 text-[12px] text-ink focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        />
        <span
          data-testid="dirty-flag"
          data-dirty={dirty}
          title={dirty ? 'Unsaved changes' : 'Saved'}
          className={dirty ? 'text-[11px] text-overflow' : 'text-[11px] text-ink-subtle'}
        >
          {dirty ? 'Unsaved' : 'Saved'}
        </span>

        <Button onClick={() => void save()} disabled={busy} data-testid="save-project">
          Save
        </Button>
        <Button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          data-testid="open-project"
        >
          Open
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".toke,application/zip"
          data-testid="project-file"
          className="hidden"
          onChange={(event) => void open(event.target.files?.[0])}
        />
      </div>

      {recoverable && (
        <div
          role="alert"
          data-testid="recovery-banner"
          className="flex w-full items-center gap-2 border-hairline border-b bg-accent-weak px-3 py-1.5 text-[12px]"
        >
          <span className="text-ink">toke closed without saving. Recover the last autosave?</span>
          <Button variant="primary" onClick={() => void recover()} data-testid="recover">
            Recover
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              void clearRecovery();
              setRecoverable(false);
            }}
          >
            Discard
          </Button>
        </div>
      )}

      {problem !== null && (
        <p role="alert" className="w-full px-3 py-1.5 text-[12px] text-overflow">
          {problem.message}
          {problem.hint !== undefined && (
            <span className="ml-1 text-ink-muted">{problem.hint}</span>
          )}
        </p>
      )}
    </>
  );
}
