import { Comment } from '../src/api/comments/entities/comment.entity';
import {
  CommentResponseDto,
  toCommentResponseDto,
} from '../src/api/comments/dto/comment-response.dto';
import { CreateCommentDto } from '../src/api/comments/dto/create-comment.dto';
import { UpdateCommentDto } from '../src/api/comments/dto/update-comment.dto';
import { createValidationPipe } from '../src/config/validation';

const ID = 'c6ba7134-97ef-4c1b-a342-001a982a7721';
const pipe = createValidationPipe();
const validate = (type: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: type });

describe('Comment DTO contracts', () => {
  it('trims content while preserving Unicode and newlines', async () => {
    await expect(
      validate(CreateCommentDto, { content: '  Xin chào\n世界  ' }),
    ).resolves.toMatchObject({ content: 'Xin chào\n世界' });
    await expect(
      validate(UpdateCommentDto, { content: '  Đã sửa  ' }),
    ).resolves.toMatchObject({ content: 'Đã sửa' });
  });

  it.each([null, '', ' ', 1, 'x'.repeat(2001)])(
    'rejects invalid content %p',
    async (content) => {
      await expect(
        validate(CreateCommentDto, { content }),
      ).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        validate(UpdateCommentDto, { content }),
      ).rejects.toMatchObject({
        status: 400,
      });
    },
  );

  it.each(['authorId', 'cardId', 'deletedAt'])(
    'rejects server-controlled field %s',
    async (field) => {
      await expect(
        validate(CreateCommentDto, { content: 'valid', [field]: ID }),
      ).rejects.toMatchObject({ status: 400 });
    },
  );

  it('serializes only the public comment contract', () => {
    const date = new Date('2026-10-16T10:00:00+07:00');
    const comment = Object.assign(new Comment(), {
      id: ID,
      cardId: ID,
      authorId: ID,
      content: 'Visible',
      createdAt: date,
      updatedAt: date,
      deletedAt: null,
      author: { passwordHash: 'secret' },
      card: { boardId: ID },
    });

    const dto: CommentResponseDto = toCommentResponseDto(comment);

    expect(dto).toEqual({
      id: ID,
      cardId: ID,
      authorId: ID,
      content: 'Visible',
      createdAt: '2026-10-16T03:00:00.000Z',
      updatedAt: '2026-10-16T03:00:00.000Z',
    });
  });
});
