import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeCard, okPage } from '../../../test/board-fixtures';
import { openCardDetail, writes } from '../../../test/card-detail-fixtures';
import { fail, ok, type MockResponse } from '../../../test/mock-api';

describe('Card Detail V2 quick actions', () => {
  it('keeps Board context when the card is outside the loaded Card page', async () => {
    const { dialog } = openCardDetail({
      extra: (card) => ({
        [`GET /boards/${card.boardId}/cards?page=1&limit=100`]: okPage([]),
      }),
    });
    expect(
      within(await dialog()).getByText(/^In Launch · Created/),
    ).toBeTruthy();
  });

  it('duplicates once per click, reports what was not copied and opens the copy', async () => {
    let answer: (response: MockResponse) => void = () => {};
    const { calls, path, boardPath, card, dialog, router } = openCardDetail({
      extra: (_source, cardPath) => ({
        [`POST ${cardPath}/duplicate`]: () =>
          new Promise<MockResponse>((resolve) => {
            answer = resolve;
          }),
      }),
    });
    const detail = await dialog();
    fireEvent.click(within(detail).getByRole('button', { name: 'Duplicate' }));
    const pending = await within(detail).findByRole('button', {
      name: 'Duplicating…',
    });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pending);
    expect(
      writes(calls).filter((call) => call.path === `${path}/duplicate`),
    ).toHaveLength(1);
    expect(within(detail).queryByText(/Copy created/)).toBeNull();

    const copy = makeCard({ ...card, id: 'copy-0000-4000-9000-000000000001' });
    answer(ok(copy, 201));
    expect(await within(detail).findByText(/Copy created/)).toBeTruthy();
    expect(
      within(detail).getByText(
        /Assignees, comments and attachments were not copied/,
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(detail).getByRole('button', { name: 'Open the copy' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `${boardPath}/cards/${copy.id}`,
      ),
    );
  });

  it('shows the real error and no success when duplication fails', async () => {
    const { dialog } = openCardDetail({
      extra: (_card, path) => ({
        [`POST ${path}/duplicate`]: fail(409, 'CARD_ARCHIVED'),
      }),
    });
    const detail = await dialog();
    fireEvent.click(within(detail).getByRole('button', { name: 'Duplicate' }));
    expect(
      await within(detail).findByText('Archived cards can’t be duplicated.'),
    ).toBeTruthy();
    expect(within(detail).queryByText(/Copy created/)).toBeNull();
  });

  it('restores an archived card on an active board from its detail', async () => {
    let archived = true;
    const { calls, path, dialog } = openCardDetail({
      card: { isArchived: true, archivedAt: '2026-10-30T00:00:00.000Z' },
      extra: (card, cardPath) => ({
        [`GET ${cardPath}`]: () => ok({ ...card, isArchived: archived }),
        [`POST ${cardPath}/restore`]: () => {
          archived = false;
          return ok({ ...card, isArchived: false });
        },
      }),
    });
    const detail = await dialog();
    expect(
      within(detail).queryByRole('button', { name: 'Duplicate' }),
    ).toBeNull();
    expect(
      within(detail).queryByRole('button', { name: 'Archive card' }),
    ).toBeNull();
    fireEvent.click(
      await within(detail).findByRole('button', { name: 'Restore card' }),
    );
    await waitFor(() =>
      expect(writes(calls).map((call) => call.path)).toEqual([
        `${path}/restore`,
      ]),
    );
    expect(
      await within(detail).findByRole('button', { name: 'Edit description' }),
    ).toBeTruthy();
  });

  it('offers no restore on an archived board or to a read-only viewer', async () => {
    const { dialog } = openCardDetail({
      card: { isArchived: true },
      boardArchived: true,
    });
    const detail = await dialog();
    expect(
      within(detail).queryByRole('button', { name: 'Restore card' }),
    ).toBeNull();
    expect(
      within(detail).getByRole('button', { name: 'Copy link' }),
    ).toBeTruthy();
  });
});

describe('Card Detail V2 dates', () => {
  it('waits for saved preferences before capturing a date editing time zone', async () => {
    let answer: (response: MockResponse) => void = () => {};
    const { calls, dialog } = openCardDetail({
      extra: (card, path) => ({
        'GET /users/me/preferences': () =>
          new Promise<MockResponse>((resolve) => {
            answer = resolve;
          }),
        [`PATCH ${path}`]: (request) =>
          ok({ ...card, ...(request.body as object) }),
      }),
    });
    const detail = await dialog();
    const edit = within(detail).getByRole('button', {
      name: 'Edit dates',
    }) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    fireEvent.click(edit);
    expect(within(detail).queryByLabelText('Due date')).toBeNull();
    expect(writes(calls)).toHaveLength(0);
    answer(
      ok({
        theme: 'system',
        timeZone: 'Asia/Ho_Chi_Minh',
        dateFormat: 'YYYY-MM-DD',
        weekStartsOn: 'monday',
      }),
    );
    await waitFor(() => expect(edit.disabled).toBe(false));
    fireEvent.click(edit);
    expect(within(detail).getByText('Times in Asia/Ho_Chi_Minh.')).toBeTruthy();
    fireEvent.change(within(detail).getByLabelText('Due date'), {
      target: { value: '2026-11-03' },
    });
    fireEvent.click(within(detail).getByRole('button', { name: 'Save dates' }));
    await within(detail).findByText('Dates saved.');
    expect(writes(calls)[0].body).toEqual({
      dueDate: '2026-11-03T10:00:00.000Z',
    });
  });

  it.each([
    ['Start', '09:00'],
    ['Due', '17:00'],
  ])(
    'clearing a newly selected %s date clears its time and leaves no unsaved changes',
    async (which, defaultTime) => {
      const { calls, dialog, router, boardPath } = openCardDetail();
      const detail = await dialog();
      fireEvent.click(
        within(detail).getByRole('button', { name: 'Edit dates' }),
      );
      const date = within(detail).getByLabelText(`${which} date`);
      const time = within(detail).getByLabelText(
        `${which} time`,
      ) as HTMLInputElement;
      fireEvent.change(date, { target: { value: '2026-11-03' } });
      expect(time.value).toBe(defaultTime);
      fireEvent.change(time, { target: { value: '11:23' } });
      fireEvent.change(date, { target: { value: '' } });
      expect(time.value).toBe('');
      expect(time.disabled).toBe(true);
      fireEvent.change(date, { target: { value: '2026-11-04' } });
      expect(time.value).toBe(defaultTime);
      fireEvent.change(date, { target: { value: '' } });
      fireEvent.click(
        within(detail).getByRole('button', { name: 'Close card' }),
      );
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(boardPath),
      );
      expect(
        screen.queryByRole('button', { name: 'Discard changes' }),
      ).toBeNull();
      expect(writes(calls)).toHaveLength(0);
    },
  );

  it('saves start and due together as instants in the saved time zone', async () => {
    const { calls, path, dialog } = openCardDetail({
      timeZone: 'Asia/Ho_Chi_Minh',
      extra: (card, cardPath) => ({
        [`PATCH ${cardPath}`]: (request) =>
          ok({ ...card, ...(request.body as object) }),
      }),
    });
    const detail = await dialog();
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit dates' }));
    // The editor works in the saved zone, never the browser's.
    expect(
      await within(detail).findByText('Times in Asia/Ho_Chi_Minh.'),
    ).toBeTruthy();
    fireEvent.change(within(detail).getByLabelText('Start date'), {
      target: { value: '2026-11-02' },
    });
    fireEvent.change(within(detail).getByLabelText('Due date'), {
      target: { value: '2026-11-03' },
    });
    // Picking a day filled sensible default times.
    expect(
      (within(detail).getByLabelText('Start time') as HTMLInputElement).value,
    ).toBe('09:00');
    fireEvent.click(within(detail).getByRole('button', { name: 'Save dates' }));

    expect(await within(detail).findByText('Dates saved.')).toBeTruthy();
    expect(writes(calls)).toEqual([
      expect.objectContaining({
        method: 'PATCH',
        path,
        body: {
          startDate: '2026-11-02T02:00:00.000Z',
          dueDate: '2026-11-03T10:00:00.000Z',
        },
      }),
    ]);
  });

  it('refuses a start after the due date without sending anything', async () => {
    const { calls, dialog } = openCardDetail();
    const detail = await dialog();
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit dates' }));
    fireEvent.change(within(detail).getByLabelText('Start date'), {
      target: { value: '2026-11-05' },
    });
    fireEvent.change(within(detail).getByLabelText('Due date'), {
      target: { value: '2026-11-04' },
    });
    fireEvent.click(within(detail).getByRole('button', { name: 'Save dates' }));
    expect(
      await within(detail).findByText(
        'The due date must be on or after the start date.',
      ),
    ).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
  });

  it('clears only the due date with null', async () => {
    const { calls, dialog } = openCardDetail({
      card: {
        startDate: '2026-11-01T01:00:00.000Z',
        dueDate: '2026-11-04T01:00:00.000Z',
      },
      extra: (card, cardPath) => ({
        [`PATCH ${cardPath}`]: ok({ ...card, dueDate: null }),
      }),
    });
    const detail = await dialog();
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit dates' }));
    fireEvent.click(
      within(detail).getByRole('button', { name: 'Clear due date' }),
    );
    fireEvent.click(within(detail).getByRole('button', { name: 'Save dates' }));
    await within(detail).findByText('Dates saved.');
    expect(writes(calls)[0].body).toEqual({ dueDate: null });
  });

  it('asks which time is meant on a fall-back night', async () => {
    const { calls, dialog } = openCardDetail({
      timeZone: 'America/New_York',
      extra: (card, cardPath) => ({
        [`PATCH ${cardPath}`]: (request) =>
          ok({ ...card, ...(request.body as object) }),
      }),
    });
    const detail = await dialog();
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit dates' }));
    expect(
      await within(detail).findByText('Times in America/New_York.'),
    ).toBeTruthy();
    fireEvent.change(within(detail).getByLabelText('Due date'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.change(within(detail).getByLabelText('Due time'), {
      target: { value: '01:30' },
    });
    fireEvent.click(within(detail).getByRole('button', { name: 'Save dates' }));
    expect(
      await within(detail).findByText(
        'Choose which of the two times you mean.',
      ),
    ).toBeTruthy();
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(detail).getByRole('radio', { name: /Second/ }));
    fireEvent.click(within(detail).getByRole('button', { name: 'Save dates' }));
    await within(detail).findByText('Dates saved.');
    expect(writes(calls)[0].body).toEqual({
      dueDate: '2026-11-01T06:30:00.000Z',
    });
  });

  it('shows dates and due status read-only to a viewer who cannot edit', async () => {
    const { dialog } = openCardDetail({
      readOnlyViewer: true,
      card: { dueDate: '2020-01-01T00:00:00.000Z' },
    });
    const detail = await dialog();
    expect(within(detail).getByText('2020-01-01 00:00')).toBeTruthy();
    expect(within(detail).getByText('Overdue')).toBeTruthy();
    expect(
      within(detail).queryByRole('button', { name: 'Edit dates' }),
    ).toBeNull();
    expect(within(detail).getByText(/View only/)).toBeTruthy();
  });
});

describe('Card Detail V2 drafts', () => {
  it.each(['cancel', 'remote'])(
    'clears title form and field errors on %s without carrying them into the next draft',
    async (action) => {
      let title = 'Ship it';
      const { calls, dialog } = openCardDetail({
        extra: (card, path) => ({
          [`GET ${path}`]: () => ok({ ...card, title }),
          [`PATCH ${path}`]: fail(
            400,
            'VALIDATION_FAILED',
            'Validation failed',
            ['title: title is rejected', 'other: Try a different title'],
          ),
        }),
      });
      const detail = await dialog();
      fireEvent.click(
        within(detail).getByRole('button', { name: 'Edit title' }),
      );
      fireEvent.change(within(detail).getByLabelText('Title'), {
        target: { value: 'Mine' },
      });
      fireEvent.click(
        within(detail).getByRole('button', { name: 'Save title' }),
      );
      await within(detail).findByText('Title is rejected');
      expect(within(detail).getByText('Try a different title')).toBeTruthy();
      if (action === 'cancel') {
        fireEvent.click(within(detail).getByRole('button', { name: 'Cancel' }));
        fireEvent.click(
          within(detail).getByRole('button', { name: 'Edit title' }),
        );
      } else {
        title = 'Theirs';
        await act(async () => {
          const { focusManager } = await import('@tanstack/react-query');
          focusManager.setFocused(false);
          focusManager.setFocused(true);
        });
        await within(detail).findByText(/Someone else changed the title/);
        expect(
          (within(detail).getByLabelText('Title') as HTMLInputElement).value,
        ).toBe('Mine');
        fireEvent.click(
          within(detail).getByRole('button', {
            name: 'Discard mine and load theirs',
          }),
        );
        expect(
          within(detail).queryByText(/Someone else changed the title/),
        ).toBeNull();
      }
      expect(
        (within(detail).getByLabelText('Title') as HTMLInputElement).value,
      ).toBe(title);
      expect(within(detail).queryByText('Title is rejected')).toBeNull();
      expect(within(detail).queryByText('Try a different title')).toBeNull();
      expect(writes(calls)).toHaveLength(1);
    },
  );

  it('guards an unsaved title on Escape and keeps it on Keep editing', async () => {
    const { dialog, path, router } = openCardDetail();
    const detail = await dialog();
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit title' }));
    fireEvent.change(within(detail).getByLabelText('Title'), {
      target: { value: 'Half typed' },
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Keep editing' }),
    );
    expect(router.state.location.pathname).toBe(path);
    expect(
      (within(detail).getByLabelText('Title') as HTMLInputElement).value,
    ).toBe('Half typed');
  });

  it('guards a half-typed checklist item too', async () => {
    const { dialog } = openCardDetail({
      extra: (card, path) => ({
        [`GET ${path}/checklists`]: ok({
          cardId: card.id,
          checkedItems: 0,
          totalItems: 0,
          completionPercentage: 0,
          checklists: [
            {
              id: 'list-1',
              cardId: card.id,
              title: 'Release',
              position: '100.0000000000',
              createdAt: card.createdAt,
              updatedAt: card.updatedAt,
              items: [],
              checkedItems: 0,
              totalItems: 0,
              completionPercentage: 0,
            },
          ],
        }),
      }),
    });
    const detail = await dialog();
    fireEvent.click(
      await within(detail).findByRole('button', {
        name: 'Add item to Release',
      }),
    );
    fireEvent.change(within(detail).getByLabelText('New item in Release'), {
      target: { value: 'Unsent item' },
    });
    fireEvent.click(within(detail).getByRole('button', { name: 'Close card' }));
    expect(
      await screen.findByRole('button', { name: 'Discard changes' }),
    ).toBeTruthy();
  });

  it('flags a remote description change instead of overwriting the draft', async () => {
    let description = 'Original';
    const { dialog } = openCardDetail({
      card: { description: 'Original' },
      extra: (source, cardPath) => ({
        [`GET ${cardPath}`]: () => ok({ ...source, description }),
      }),
    });
    const detail = await dialog();
    fireEvent.click(
      within(detail).getByRole('button', { name: 'Edit description' }),
    );
    fireEvent.change(within(detail).getByLabelText('Description'), {
      target: { value: 'Mine' },
    });
    description = 'Theirs';
    fireEvent.click(within(detail).getByRole('button', { name: 'Close card' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Keep editing' }),
    );
    await act(async () => {
      const { focusManager } = await import('@tanstack/react-query');
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(
      await within(detail).findByText(
        /Someone else changed the description/,
        undefined,
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    expect(
      (within(detail).getByLabelText('Description') as HTMLTextAreaElement)
        .value,
    ).toBe('Mine');
    fireEvent.click(
      within(detail).getByRole('button', {
        name: 'Discard mine and load theirs',
      }),
    );
    expect(
      (within(detail).getByLabelText('Description') as HTMLTextAreaElement)
        .value,
    ).toBe('Theirs');
  });
});
