import { Link } from 'react-router';
import { buttonClassName } from '../components/Button';
import { FullPageNotice } from '../components/FullPageNotice';

export function NotFoundPage() {
  return (
    <FullPageNotice
      eyebrow="404"
      title="Page not found"
      description="The page you are looking for does not exist."
      actions={
        <Link to="/" className={buttonClassName()}>
          Go to home
        </Link>
      }
    />
  );
}
