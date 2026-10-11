
import { useState } from 'react'
import {
  House,
  UserRound,
  BriefcaseBusiness,
  FolderGit2,
  Mail,
  Download,
  Menu,
  X,
  ArrowRight
} from 'lucide-react'
import { FaGithub, FaLinkedin } from 'react-icons/fa'

const navigation = [
  { name: 'Home', id: 'home', icon: House },
  { name: 'About', id: 'about', icon: UserRound },
  { name: 'Experience', id: 'experience', icon: BriefcaseBusiness },
  { name: 'Projects', id: 'projects', icon: FolderGit2 },
  { name: 'Contact', id: 'contact', icon: Mail },
]

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState('home')

  function navigate(id) {
    setActive(id)
    setMenuOpen(false)

    document.getElementById(id)?.scrollIntoView({
      behavior: 'smooth'
    })
  }

  return (
    <div className="min-h-screen bg-[#0b1120] text-slate-100">

      {/* Mobile header */}
      <header className="fixed top-0 z-40 flex w-full items-center justify-between border-b border-slate-800 bg-[#111b2e] px-6 py-4 lg:hidden">
        <span className="text-xl font-bold text-cyan-400">
          AM.
        </span>

        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          className="cursor-pointer"
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      {/* Mobile overlay */}
      {menuOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-slate-800 bg-[#111b2e] p-8 transition-transform duration-300 lg:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="mb-14">
          <h2 className="text-3xl font-bold tracking-tight text-cyan-400">
            AM.
          </h2>

          <p className="mt-1 text-xs uppercase tracking-[0.25em] text-slate-500">
            Portfolio
          </p>
        </div>

        {/* Navigation */}
        <nav
          className="flex flex-col gap-2"
          aria-label="Main navigation"
        >
          {navigation.map(({ name, id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => navigate(id)}
              className={`flex cursor-pointer items-center gap-4 rounded-lg px-4 py-3 text-left transition-colors ${
                active === id
                  ? 'bg-cyan-400/10 text-cyan-400'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon size={19} />

              <span className="text-sm font-medium">
                {name}
              </span>
            </button>
          ))}
        </nav>

        {/* Sidebar footer */}
        <div className="mt-auto border-t border-slate-700 pt-6">
          <a
            href="/resume.pdf"
            download
            className="flex items-center gap-3 text-sm text-slate-300 transition hover:text-cyan-400"
          >
            <Download size={18} />
            Download Resume
          </a>

          <p className="mt-6 text-xs text-slate-600">
            © {new Date().getFullYear()} Askar Mujhib
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="px-6 pt-20 sm:px-10 lg:ml-64 lg:px-16 lg:pt-0 xl:px-24">

        {/* HOME */}
        <section
          id="home"
          className="flex min-h-screen flex-col justify-center py-24"
        >
          <p className="mb-4 text-sm font-medium tracking-[0.2em] text-cyan-400">
            HELLO, I'M
          </p>

          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl xl:text-7xl">
            Askar Mujhib
            <span className="text-cyan-400">.</span>
          </h1>

          <h2 className="mt-6 text-xl text-slate-300 sm:text-2xl">
            Infrastructure & Network Engineer
          </h2>

          <p className="mt-6 max-w-xl text-base leading-8 text-slate-400">
            Passionate about networking, infrastructure, and technology.
            Building reliable systems while continuously learning,
            experimenting, and developing new skills.
          </p>

          {/* Action buttons */}
          <div className="mt-10 flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => navigate('projects')}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-cyan-400 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              View Projects
              <ArrowRight size={18} />
            </button>

            <a
              href="/resume.pdf"
              download
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-6 py-3 font-medium transition hover:border-cyan-400 hover:text-cyan-400"
            >
              <Download size={18} />
              Download Resume
            </a>
          </div>

          {/* Social links */}
          <div className="mt-12 flex gap-6">
            <a
              href="https://github.com/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="text-slate-400 transition hover:text-cyan-400"
            >
              <FaGithub size={23} />
            </a>

            <a
              href="https://linkedin.com/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              className="text-slate-400 transition hover:text-cyan-400"
            >
              <FaLinkedin size={23} />
            </a>
          </div>
        </section>

        {/* ABOUT */}
        <section
          id="about"
          className="min-h-[60vh] scroll-mt-24 border-t border-slate-800 py-24"
        >
          <p className="mb-3 text-sm font-medium text-cyan-400">
            01 / ABOUT
          </p>

          <h2 className="text-3xl font-bold sm:text-4xl">
            About Me<span className="text-cyan-400">.</span>
          </h2>

          <p className="mt-6 max-w-2xl leading-8 text-slate-400">
            I'm an infrastructure and networking enthusiast with an
            interest in building reliable systems, solving technical
            challenges, and exploring new technologies.
          </p>
        </section>

        {/* EXPERIENCE */}
        <section
          id="experience"
          className="min-h-[60vh] scroll-mt-24 border-t border-slate-800 py-24"
        >
          <p className="mb-3 text-sm font-medium text-cyan-400">
            02 / EXPERIENCE
          </p>

          <h2 className="text-3xl font-bold sm:text-4xl">
            Experience<span className="text-cyan-400">.</span>
          </h2>

          <p className="mt-6 max-w-2xl leading-8 text-slate-400">
            My professional experience, education, and certifications
            will be showcased here.
          </p>
        </section>

        {/* PROJECTS */}
        <section
          id="projects"
          className="min-h-[60vh] scroll-mt-24 border-t border-slate-800 py-24"
        >
          <p className="mb-3 text-sm font-medium text-cyan-400">
            03 / PROJECTS
          </p>

          <h2 className="text-3xl font-bold sm:text-4xl">
            Featured Projects<span className="text-cyan-400">.</span>
          </h2>

          <p className="mt-6 max-w-2xl leading-8 text-slate-400">
            A collection of networking labs, infrastructure projects,
            and software development work.
          </p>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-[#111b2e] p-6 transition hover:border-cyan-400/50">
              <FolderGit2 className="mb-5 text-cyan-400" size={28} />

              <h3 className="text-xl font-semibold">
                Project Coming Soon
              </h3>

              <p className="mt-3 text-sm leading-7 text-slate-400">
                My future networking and infrastructure projects
                will appear here.
              </p>
            </div>
          </div>
        </section>

        {/* CONTACT */}
        <section
          id="contact"
          className="min-h-[60vh] scroll-mt-24 border-t border-slate-800 py-24"
        >
          <p className="mb-3 text-sm font-medium text-cyan-400">
            04 / CONTACT
          </p>

          <h2 className="text-3xl font-bold sm:text-4xl">
            Get In Touch<span className="text-cyan-400">.</span>
          </h2>

          <p className="mt-6 max-w-2xl leading-8 text-slate-400">
            Interested in connecting, collaborating, or discussing
            technology? Feel free to reach out.
          </p>

          <div className="mt-8 flex gap-6">
            <a
              href="https://github.com/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="text-slate-400 transition hover:text-cyan-400"
            >
              <FaGithub size={25} />
            </a>

            <a
              href="https://linkedin.com/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              className="text-slate-400 transition hover:text-cyan-400"
            >
              <FaLinkedin size={25} />
            </a>
          </div>
        </section>

      </main>
    </div>
  )
}

export default App
