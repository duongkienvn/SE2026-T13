import { randomUUID } from 'node:crypto';

// This single-process model is an experiment, not a persistent job system.
export function createJobModel(exportBoard) {
  const jobs = new Map();
  const keys = new Map();
  const response = (job) => ({ id: job.id, status: job.board });
  return {
    submit(user, key, board) {
      if (
        ![user, key, board].every(
          (value) => typeof value === 'string' && value.length > 0,
        )
      )
        throw new Error('invalid request');
      let userKeys = keys.get(user);
      if (!userKeys) keys.set(user, (userKeys = new Map()));
      const previous = userKeys.get(key);
      if (previous) {
        if (previous.board !== board) throw new Error('conflict');
        return response(previous);
      }
      const job = { id: randomUUID(), user, board, status: 'QUEUED' };
      jobs.set(job.id, job);
      userKeys.set(key, job);
      setImmediate(async () => {
        job.status = 'RUNNING';
        try {
          await exportBoard(board);
          job.status = 'COMPLETED';
        } catch {
          job.status = 'FAILED';
        }
      });
      return response(job);
    },
    status(user, id) {
      const job = jobs.get(id);
      if (!job || job.user !== user) throw new Error('not found');
      return response(job);
    },
  };
}
