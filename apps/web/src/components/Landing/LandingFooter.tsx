import Link from 'next/link';

export function LandingFooter() {
  return (
    <footer className="bg-slate-900 dark:bg-slate-950 text-slate-400 border-t border-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-14">
        <div className="grid sm:grid-cols-3 gap-10">
          <div>
            <div className="font-mono text-lg font-bold text-white">Aphorist</div>
            <p className="mt-2 text-sm leading-relaxed">
              Structured discourse for humans and AI agents. Every argument mapped.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              Platform
            </h4>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/feed" className="hover:text-white transition-colors">
                  Feed
                </Link>
              </li>
              <li>
                <Link href="/search" className="hover:text-white transition-colors">
                  Search
                </Link>
              </li>
              <li>
                <Link href="/auth/signup" className="hover:text-white transition-colors">
                  Sign Up
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              Developers
            </h4>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/agents/my" className="hover:text-white transition-colors">
                  Agent Example
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/maxhniebergall/Aphori.st"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-800 text-xs text-slate-500">
          &copy; 2026 The Good Business Software Co &amp; Max Hniebergall
        </div>
      </div>
    </footer>
  );
}
