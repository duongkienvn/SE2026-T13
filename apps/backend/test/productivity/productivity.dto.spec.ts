import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListTasksDto } from '../../src/api/productivity/dto/list-tasks.dto';
import { toResponseDto } from '../../src/common/dto/to-response-dto';
import {
  HomeDashboardDto,
  TaskCardSummaryDto,
} from '../../src/api/productivity/dto/productivity-response.dto';

const id = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const check = (value: object) =>
  validate(plainToInstance(ListTasksDto, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('productivity DTO contracts', () => {
  it('defaults and parses pagination and match-any label CSV', async () => {
    expect(plainToInstance(ListTasksDto, {})).toMatchObject({
      page: 1,
      limit: 20,
      group: 'ALL',
      sort: 'dueDate',
    });
    const value = plainToInstance(ListTasksDto, {
      page: '2',
      limit: '100',
      labelIds: id.toUpperCase(),
      dueFrom: '2026-03-08T12:00:00-04:00',
    });
    expect(await validate(value)).toEqual([]);
    expect(value).toMatchObject({ page: 2, limit: 100, labelIds: [id] });
  });

  it.each([
    { userId: id },
    { page: '0' },
    { page: '1.5' },
    { page: '1e2' },
    { page: '9007199254740992' },
    { limit: '101' },
    { limit: '' },
    { group: 'DONE' },
    { sort: 'title' },
    { workspaceId: 'bad' },
    { boardId: '' },
    { labelIds: '' },
    { labelIds: [id] },
    { labelIds: `${id},${id.toUpperCase()}` },
    { labelIds: `${id},bad` },
    { dueFrom: '2026-03-08' },
    { dueTo: '2026-03-08T12:00:00' },
    { dueFrom: '2026-02-30T12:00:00Z' },
    { dueTo: '2026-03-08T25:00:00Z' },
    { dueFrom: ['2026-03-08T12:00:00Z'] },
    { dueTo: null },
  ])('rejects malformed input %j', async (value) => {
    expect((await check(value)).length).toBeGreaterThan(0);
  });

  it('limits labels to 50 distinct UUIDs', async () => {
    const ids = Array.from(
      { length: 51 },
      (_, i) => `c6ba7134-97ef-4c1b-a342-${String(i).padStart(12, '0')}`,
    );
    expect(await check({ labelIds: ids.slice(0, 50).join(',') })).toEqual([]);
    expect((await check({ labelIds: ids.join(',') })).length).toBeGreaterThan(
      0,
    );
  });

  it('allowlists Task, nested label and Home fields', () => {
    const card = {
      id,
      labels: [
        { id, name: 'Real', color: '#123456', boardId: id, private: true },
      ],
      description: 'hidden',
      position: '100',
      passwordHash: 'secret',
    };
    const task = toResponseDto(TaskCardSummaryDto, card);
    expect(task).not.toHaveProperty('description');
    expect(task).not.toHaveProperty('position');
    expect(task.labels).toEqual([{ id, name: 'Real', color: '#123456' }]);
    const home = toResponseDto(HomeDashboardDto, {
      summary: { assignedActiveCount: 1, email: 'private' },
      upNext: [card],
      starredBoards: [{ id, members: ['hidden'] }],
      recentBoards: [],
      fakeAnalytics: 7,
    });
    expect(home).not.toHaveProperty('fakeAnalytics');
    expect(home.summary).not.toHaveProperty('email');
    expect(home.starredBoards[0]).not.toHaveProperty('members');
  });
});
