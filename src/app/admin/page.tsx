import { logout } from "./login/actions";

export default function AdminHome() {
  return (
    <div className="min-h-screen bg-zinc-50 p-8 dark:bg-black">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            mediasurface admin
          </h1>
          <form action={logout}>
            <button
              type="submit"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Log out
            </button>
          </form>
        </div>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          You&apos;re authenticated. The site switcher, post list, and editor
          land here next.
        </p>
      </div>
    </div>
  );
}
