import { createBrowserRouter, RouterProvider } from 'react-router';
import { flushSync } from 'react-dom';
import { routes } from './app/routes';

const router = createBrowserRouter(routes);

export default function App() {
  return (
    <RouterProvider
      router={router}
      flushSync={(callback) => {
        flushSync(callback);
      }}
    />
  );
}
