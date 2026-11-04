import { splitContent, validRenderSpans } from './mentions';
import type { CommentMention } from './types';

/**
 * Comment text with server-validated mention spans styled inline. Spans are
 * checked again here; anything odd renders the whole text as plain text.
 * Never HTML, never links: mentions are styled text only.
 */
export function MentionText({
  content,
  mentions,
  enabled,
}: {
  content: string;
  mentions: CommentMention[] | undefined;
  /** False when the viewer cannot read the Board member directory. */
  enabled: boolean;
}) {
  const spans = enabled ? validRenderSpans(content, mentions) : undefined;
  if (!spans) return <>{content}</>;
  return (
    <>
      {splitContent(content, spans).map((part, index) =>
        part.mention ? (
          <span key={index} className="comment-mention">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
