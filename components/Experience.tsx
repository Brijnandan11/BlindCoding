"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  ArrowUpRight,
  ArrowRight,
  Code,
  Clock,
  EyeSlash,
  Keyboard,
  ShieldCheck,
  Trophy,
  Check,
  Plus,
  Download,
  SignOut,
  Users,
  Lightning,
  WarningCircle,
  CaretDown,
  Terminal,
} from "@phosphor-icons/react";

type State = {
  phase: string;
  serverNow: number;
  participant: { name: string; code: string; team: string; branch?: string };
  attempt: null | { id: string; startedAt: number; viewingEndsAt: number; codingEndsAt: number };
  contest?: { readingMinutes?: number; codingMinutes?: number };
  submission: null | {
    status: string;
    score?: number;
    functional?: number;
    structure?: number;
    syntax?: number;
    completionMs: number;
    error?: string;
  };
};
type Row = {
  id: string;
  name: string;
  team: string;
  score: number;
  completionMs: number;
  rank: number;
};
async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch("/api/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
const LOCAL_ATTEMPT_KEY = "blind-coding-attempt-v1";
const time = (ms: number) =>
  `${Math.floor(Math.max(0, ms) / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((Math.max(0, ms) / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;
function readStoredAttempt() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_ATTEMPT_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as State | null;
    if (!state?.attempt) return null;
    const activeWindow = Date.now() < state.attempt.codingEndsAt;
    return activeWindow ? state : null;
  } catch {
    return null;
  }
}
function writeStoredAttempt(state: State | null) {
  if (typeof window === "undefined") return;
  try {
    if (!state?.attempt) {
      window.localStorage.removeItem(LOCAL_ATTEMPT_KEY);
      return;
    }
    window.localStorage.setItem(LOCAL_ATTEMPT_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures so the contest still runs in-memory.
  }
}
const reveal = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.65 },
};
export default function Experience({ page }: { page: string }) {
  if (page === "contest") return <Contest />;
  return (
    <div className="site">
      <Header page={page} />
      <main>
        {page === "home" ? (
          <Home />
        ) : page === "login" ? (
          <Login />
        ) : page === "instructions" || page === "rules" ? (
          <Instructions publicRules={page === "rules"} />
        ) : page === "leaderboard" ? (
          <Leaderboard />
        ) : page === "result" ? (
          <Result />
        ) : page === "admin" ? (
          <Admin />
        ) : null}
      </main>
      <Footer />
    </div>
  );
}
function Header({ page }: { page: string }) {
  return (
    <header className="header">
      <Link className="brand" href="/" aria-label="Coding Club home">
        <img
          src="/logo.png"
          onError={(e) => {
            e.currentTarget.src = "/logo-original.png";
          }}
          alt="Coding Club"
        />
      </Link>
      <nav>
        <Link className={page === "home" ? "active" : ""} href="/">
          The challenge
        </Link>
        <Link className={page === "rules" ? "active" : ""} href="/rules">
          How it works
        </Link>
        <Link className={page === "leaderboard" ? "active" : ""} href="/leaderboard">
          Leaderboard <ArrowUpRight size={13} />
        </Link>
      </nav>
      <Link href="/login" className="nav-cta">
        Participant login <ArrowUpRight size={17} />
      </Link>
    </header>
  );
}
function Footer() {
  return (
    <footer>
      <Link href="/" className="footer-wordmark">
        BLIND<span>_</span>CODING
      </Link>
      <p>Built for the ones who remember.</p>
      <div>
        <span>© {new Date().getFullYear()} Coding Club</span>
        <Link href="/admin">
          Organizer access <ArrowUpRight />
        </Link>
      </div>
    </footer>
  );
}
function Home() {
  return (
    <>
      <section className="hero">
        <div className="memory-orbits" aria-hidden="true">
          <i />
          <i />
          <i />
          <span>{"{ }"}</span>
        </div>
        <div className="hero-grid" />
        <div className="hero-inner">
          <motion.div {...reveal} className="eyebrow">
            <span className="live-dot" /> CODING CLUB PRESENTS{" "}
            <span className="edition">THE 2026 EDITION</span>
          </motion.div>
          <div className="hero-columns">
            <div className="hero-copy">
              <motion.h1 {...reveal}>
                Out of sight.
                <br />
                Into <span>memory.</span>
                <i>_</i>
              </motion.h1>
              <motion.p {...reveal}>
                The screen goes dark. Your mind takes over.
                <br />
                One program. Twenty minutes. Just you and what you remember.
              </motion.p>
              <motion.div {...reveal} className="hero-actions">
                <Link className="button primary" href="/login">
                  Enter the challenge <ArrowUpRight size={21} />
                </Link>
                <Link className="text-link" href="/rules">
                  Explore the rules <ArrowRight size={18} />
                </Link>
              </motion.div>
              <motion.div {...reveal} className="hero-note">
                <ShieldCheck size={18} />
                <span>Individual event</span>
                <b>·</b>
                <span>C language</span>
                <b>·</b>
                <span>One final submission</span>
              </motion.div>
            </div>
            <motion.div
              initial={{ opacity: 0, y: 35, rotate: 2 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ duration: 1, delay: 0.2 }}
              className="hero-art"
            >
              <div className="art-topline">
                <span>YOUR MEMORY IS THE EDITOR.</span>
                <span>01 / 02</span>
              </div>
              <div className="code-window hero-code-cycle">
                <div className="window-top">
                  <div className="dots">
                    <i />
                    <i />
                    <i />
                  </div>
                  <span>remember_this.c</span>
                  <span className="window-lang">C</span>
                </div>
                <div className="code-content">
                  <div className="line-numbers">
                    01
                    <br />
                    02
                    <br />
                    03
                    <br />
                    04
                    <br />
                    05
                    <br />
                    06
                    <br />
                    07
                    <br />
                    08
                    <br />
                    09
                    <br />
                    10
                    <br />
                    11
                    <br />
                    12
                  </div>
                  <pre>
                    <span className="code-purple">#include</span>{" "}
                    <span className="code-green">&lt;stdio.h&gt;</span>
                    {"\n\n"}
                    <span className="code-purple">int</span> <span className="code-blue">main</span>
                    (<span className="code-purple">void</span>) {"{\n"}
                    {"    "}
                    <span className="code-purple">int</span> n, sum ={" "}
                    <span className="code-orange">0</span>;{"\n"}
                    {"    "}
                    <span className="code-blue">scanf</span>(
                    <span className="code-green">"%d"</span>, &amp;n);{"\n\n"}
                    {"    "}
                    <span className="code-purple">for</span> (
                    <span className="code-purple">int</span> i ={" "}
                    <span className="code-orange">1</span>; i &lt;= n; i++) {"{\n"}
                    {"        "}sum += i;{"\n"}
                    {"    }\n\n"}
                    {"    "}
                    <span className="code-blue">printf</span>(
                    <span className="code-green">"%d"</span>, sum);{"\n}"}
                  </pre>
                </div>
                <div className="code-fade" />
                <div className="dark-label">
                  <EyeSlash size={22} />
                  <span>And then, nothing.</span>
                  <span className="blinking-cursor" />
                </div>
              </div>
              <div className="floating-timer">
                <span className="timer-icon">
                  <Clock size={20} />
                </span>
                <div>
                  <small>TIME TO REMEMBER</small>
                  <strong>
                    05<span>:</span>00
                  </strong>
                </div>
                <span className="timer-ring" />
              </div>
              <div className="art-bottom">
                <span>
                  <span className="live-dot" /> THE ULTIMATE MEMORY TEST
                </span>
                <Keyboard size={20} />
              </div>
            </motion.div>
          </div>
        </div>
        <div className="hero-bottom">
          <span>LESS SCREEN. MORE INSTINCT.</span>
          <a href="#format">
            SCROLL TO DISCOVER <CaretDown size={15} />
          </a>
          <span>20 MINUTES. ZERO DISTRACTIONS.</span>
        </div>
      </section>
      <section className="format-section" id="format">
        <motion.div {...reveal} className="section-heading">
          <div>
            <span className="eyebrow blue">THE FORMAT</span>
            <h2>
              A little time.
              <br />A lot of <span>nerve.</span>
            </h2>
          </div>
          <p>
            It’s simple on paper. A different story
            <br />
            when the screen goes black.
          </p>
        </motion.div>
        <div className="format-grid">
          {[
            {
              n: "01",
              icon: Code,
              title: "Study the source.",
              time: "05",
              unit: "MINUTES",
              text: "Look closely. Trace the logic. Make every line count. This is your only time with the code.",
              class: "study",
            },
            {
              n: "02",
              icon: EyeSlash,
              title: "Trust your memory.",
              time: "15",
              unit: "MINUTES",
              text: "A completely black screen. No cursor, no hints. Recreate the C program from memory.",
              class: "blind",
            },
            {
              n: "03",
              icon: Keyboard,
              title: "Make your move.",
              time: "⌃ ↵",
              unit: "CTRL + ENTER",
              text: "One shortcut. One final submission. Your accuracy comes first. Speed breaks the tie.",
              class: "submit",
            },
          ].map((x) => (
            <motion.article {...reveal} key={x.n} className={"format-card " + x.class}>
              <>
                <div className="format-top">
                  <span>/{x.n}</span>
                  <x.icon key="icon" size={25} />
                </div>
                <div className="format-number">
                  {x.time}
                  <small>{x.unit}</small>
                </div>
                <h3>{x.title}</h3>
                <p>{x.text}</p>
              </>
            </motion.article>
          ))}
        </div>
      </section>
      <section className="manifesto">
        <motion.div {...reveal}>
          <span className="eyebrow blue">NO AUTOCOMPLETE. ALL YOU.</span>
          <h2>
            Your best IDE?
            <br />
            <span>The one in your head.</span>
          </h2>
          <p>
            Three nominees from every team. Three independent challengers.
            <br />
            One leaderboard. This time, you write your own place in it.
          </p>
          <Link className="button primary" href="/login">
            I’m up for it <ArrowUpRight size={20} />
          </Link>
        </motion.div>
        <div className="manifesto-symbol" aria-hidden="true">
          {"{ }"}
        </div>
      </section>
    </>
  );
}
function Login() {
  const router = useRouter();
  const [team, setTeam] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  return (
    <section className="entry-layout">
      <motion.div {...reveal} className="entry-copy">
        <span className="eyebrow blue">YOUR CHALLENGE STARTS HERE</span>
        <h1>
          Ready to
          <br />
          go <span>dark?</span>
        </h1>
        <p>
          Leave the screen behind.
          <br />
          Bring everything you remember.
        </p>
        <div className="entry-stats">
          <div>
            <strong>05</strong>
            <span>MIN TO STUDY</span>
          </div>
          <div>
            <strong>15</strong>
            <span>MIN TO RECREATE</span>
          </div>
          <div>
            <strong>01</strong>
            <span>FINAL SHOT</span>
          </div>
        </div>
      </motion.div>
      <motion.form
        {...reveal}
        className="entry-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setLoading(true);
          setError("");
          try {
            await api("auth/login", "POST", { team, name });
            router.push("/instructions");
          } catch (e) {
            setError((e as Error).message);
            setLoading(false);
          }
        }}
      >
        <span className="panel-icon">
          <Terminal size={26} />
        </span>
        <h2>Take your seat.</h2>
        <p>Enter your team and participant name.</p>
        <label htmlFor="team">TEAM NAME</label>
        <input
          id="team"
          placeholder="Your team name"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          required
          autoComplete="off"
          maxLength={100}
        />
        <label htmlFor="participant-name">PARTICIPANT NAME</label>
        <input id="participant-name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" maxLength={100} />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={loading}>
          {loading ? "Verifying your code…" : "Enter contest"}
          <ArrowRight size={20} />
        </button>
        <div className="secure-note">
          <ShieldCheck size={16} /> Your progress is securely saved.
        </div>

        <p className="help-note">Don’t have a code? Contact your event organizer.</p>
      </motion.form>
    </section>
  );
}
function Instructions({ publicRules }: { publicRules: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [timing, setTiming] = useState({ readingMinutes: 5, codingMinutes: 15 });
  useEffect(() => {
    api<{ contest?: { readingMinutes?: number; codingMinutes?: number } }>("state")
      .then((s) => setTiming({ readingMinutes: s.contest?.readingMinutes || 5, codingMinutes: s.contest?.codingMinutes || 15 }))
      .catch(() => {});
  }, []);
  const rules = [
    "You compete individually. Each team nominates exactly three participants.",
    `Study the given C program for ${timing.readingMinutes} minutes. The timer starts when you begin.`,
    `After ${timing.readingMinutes} minutes, the entire contest screen becomes black.`,
    "Recreate the program from memory. No code, timer, or cursor is shown.",
    `You have up to ${timing.codingMinutes} minutes to type. Refreshing does not reset your timer.`,
    "Press Ctrl + Enter or F10 to submit. Only one final submission is allowed.",
    "Accuracy determines your rank. Completion time breaks score ties.",
    "Submit before the deadline for partial credit. Expired drafts are not submitted.",
  ];
  return (
    <section className="content-page rules-page">
      <motion.div {...reveal} className="page-heading">
        <span className="eyebrow blue">BEFORE THE LIGHTS GO OUT</span>
        <h1>
          Know the <span>rules.</span>
        </h1>
        <p>A fair challenge. A clear head. Here’s everything you need to know.</p>
      </motion.div>
      <div className="rules-layout">
        <div className="rules-list">
          {rules.map((r, i) => (
            <motion.div {...reveal} key={r}>
              <>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <p>{r}</p>
              </>
            </motion.div>
          ))}
        </div>
        <aside className="rules-aside">
          <Keyboard size={35} />
          <span className="eyebrow">REMEMBER THIS SHORTCUT</span>
          <div className="keys">
            <kbd>ctrl</kbd>
            <span>+</span>
            <kbd>↵</kbd>
          </div>
          <h3>Your only submit button.</h3>
          <p>F10 also works. Make sure your keyboard is ready before you start.</p>
          <div className="notice">
            <WarningCircle size={20} />
            <span>
              Use a desktop or laptop. Stay on this page. Your timer continues if you leave.
            </span>
          </div>
          {publicRules ? (
            <Link className="button primary full" href="/login">
              Enter the challenge <ArrowRight />
            </Link>
          ) : (
            <>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                />
                <span>I understand the rules and I’m ready.</span>
              </label>
              <button
                className="button primary full"
                disabled={!checked || loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    await document.documentElement.requestFullscreen?.().catch(() => {});
                    const next = await api<State>("attempt/start", "POST", {});
                    writeStoredAttempt(next);
                    router.push("/contest");
                  } catch (e) {
                    setError((e as Error).message);
                    setLoading(false);
                  }
                }}
              >
                {loading ? "Starting…" : `Start my ${timing.readingMinutes} minutes`}
                <ArrowRight size={19} />
              </button>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
function Contest() {
  const router = useRouter();
  const [state, setState] = useState<State | null>(null),
    [source, setSource] = useState(""),
    [now, setNow] = useState(Date.now()),
    [error, setError] = useState("");
  const localFallback = state ?? readStoredAttempt();
  const refreshing = useRef(false);
  const saving = useRef(false);
  const offset = useRef(0),
    input = useRef<HTMLTextAreaElement>(null),
    draft = useRef(""),
    revision = useRef(0),
    loaded = useRef(false),
    submitting = useRef(false);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const s = await api<State>("attempt/state");
      offset.current = s.serverNow - Date.now();
      setState(s);
      writeStoredAttempt(s);
      setError("");
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      if (/^Please sign in|^Participant not found/.test(message)) router.replace("/login");
    } finally {
      refreshing.current = false;
    }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset.current), 50);
    return () => clearInterval(id);
  }, []);
  const localPhase = localFallback?.submission
    ? "SUBMITTED"
    : localFallback?.attempt
      ? now < localFallback.attempt.viewingEndsAt
        ? "VIEWING"
        : now < localFallback.attempt.codingEndsAt
          ? "CODING"
          : "EXPIRED"
      : localFallback?.phase;
  useEffect(() => {
    let active = true;
    if (localPhase === "VIEWING") {
      api("attempt/source")
        .then((d) => {
          if (active) setSource(d.source || "");
        })
        .catch(() => {
          if (active) setSource("");
        });
    } else setSource("");
    return () => {
      active = false;
    };
  }, [localPhase]);
  useEffect(() => {
    if (localPhase !== "CODING" || loaded.current) return;
    let active = true,
      pending = false;
    const restore = async () => {
      if (pending || loaded.current) return;
      pending = true;
      try {
        const saved = await api("attempt/draft");
        if (!active) return;
        // Preserve keystrokes entered while the server draft is in flight.
        draft.current = saved.draft + draft.current;
        revision.current = saved.revision;
        if (input.current) {
          input.current.value = draft.current;
          input.current.selectionStart = input.current.selectionEnd = draft.current.length;
        }
        loaded.current = true;
        input.current?.focus();
      } catch {
      } finally {
        pending = false;
      }
    };
    restore();
    const timer = setInterval(restore, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [localPhase]);
  useEffect(() => {
    if (localPhase !== "CODING") return;
    document.body.classList.add("is-blind");
    const focus = () => input.current?.focus();
    focus();
    const id = setInterval(() => {
      if (loaded.current && !submitting.current && !saving.current) {
        saving.current = true;
        api("attempt/draft", "PUT", { source: draft.current, revision: ++revision.current })
          .catch(() => {})
          .finally(() => {
            saving.current = false;
          });
      }
    }, 2000);
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", focus);
      document.body.classList.remove("is-blind");
    };
  }, [localPhase]);
  async function submit() {
    if (submitting.current || !loaded.current) return;
    submitting.current = true;
    try {
      await api("submission", "POST", { source: draft.current });
      await document.exitFullscreen?.().catch(() => {});
      router.push("/result");
    } catch {
      submitting.current = false;
      await refresh();
    }
  }
  if (!localFallback) return <div className="black-screen" />;
  if (localPhase === "CODING")
    return (
      <div
        className="black-screen"
        onClick={() => input.current?.focus()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="blind-timer" aria-live="polite" aria-atomic="true">
          <small>TIME LEFT</small>
          <strong>{time(Math.max(0, (localFallback.attempt?.codingEndsAt || now) - now))}</strong>
        </div>
        <textarea
          ref={input}
          aria-label="Blind code input. Press Control Enter or F10 to submit."
          className="blind-input"
          autoFocus
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onPaste={(e) => e.preventDefault()}
          onCopy={(e) => e.preventDefault()}
          onCut={(e) => e.preventDefault()}
          onChange={(e) => {
            draft.current = e.target.value;
          }}
          onBlur={() => {
            setTimeout(() => input.current?.focus(), 0);
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey && e.key === "Enter") || e.key === "F10") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Tab") {
              e.preventDefault();
              const el = e.currentTarget;
              const start = el.selectionStart,
                end = el.selectionEnd;
              el.setRangeText("    ", start, end, "end");
              draft.current = el.value;
            }
          }}
        />
      </div>
    );
  if (localPhase === "SUBMITTED")
    return (
      <div className="status-screen">
        <Check size={48} />
        <h1>Submission received.</h1>
        <Link className="button primary" href="/result">
          View my result <ArrowRight />
        </Link>
      </div>
    );
  if (localPhase === "EXPIRED")
    return (
      <div className="status-screen">
        <Clock size={48} />
        <h1>Time’s up.</h1>
        <p>
          Your coding period has ended. Your draft was not submitted and will not receive a score.
        </p>
        <Link href="/leaderboard" className="button primary">
          View leaderboard <ArrowRight />
        </Link>
      </div>
    );
  return (
    <div
      className="study-screen"
      onCopy={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && ["c", "a"].includes(e.key.toLowerCase()))
          e.preventDefault();
      }}
    >
      <header>
        <Link href="/" className="footer-wordmark">
          BLIND<span>_</span>CODING
        </Link>
        <span className="study-pill">
          <span className="live-dot" /> STUDY PHASE
        </span>
        <div className="study-count">
          <small>SCREEN GOES DARK IN</small>
          <strong>{time((localFallback.attempt?.viewingEndsAt || now) - now)}</strong>
        </div>
      </header>
      {!localFallback ? (
        <div className="loading-block">
          {error || "Connecting to your attempt…"}
          {error && <Link href="/login">Participant login →</Link>}
        </div>
      ) : localPhase === "WAITING" ? (
        <div className="status-screen">
          <h1>Your challenge awaits.</h1>
          <Link href="/instructions" className="button primary">
            Read instructions <ArrowRight />
          </Link>
        </div>
      ) : (
        <>
          <div className="study-title">
            <div>
              <span className="eyebrow blue">LOOK CLOSELY. REMEMBER EVERYTHING.</span>
              <h1>Your next {localFallback.contest?.readingMinutes || 5} minutes.</h1>
            </div>
            <span>
              <Code size={18} /> C / Read only
            </span>
          </div>
          <div className="study-code">
            <div className="study-code-top">
              <span>challenge.c</span>
              <span>
                {localFallback.participant.name} · {localFallback.participant.team}
              </span>
            </div>
            <pre>{source || "Loading source securely…"}</pre>
          </div>
          <p className="study-bottom">
            <EyeSlash size={18} /> When the screen turns black, begin typing. Submit with{" "}
            <kbd>Ctrl + Enter</kbd> or <kbd>F10</kbd>.
          </p>
        </>
      )}
    </div>
  );
}
function Leaderboard() {
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [release, setRelease] = useState<{ locked: boolean; availableAt: number | null; codingMinutes?: number } | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let delay = 10000;
      try {
        const d = await api("leaderboard");
        if (!active) return;
        setRows(d.rows);
        setRelease({ locked: d.locked, availableAt: d.availableAt, codingMinutes: d.codingMinutes });
        setError("");
        if (d.locked && d.availableAt > d.serverNow)
          delay = Math.min(delay, d.availableAt - d.serverNow + 50);
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) {
          setLoading(false);
          timer = setTimeout(load, delay);
        }
      }
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  if (!loading && !error && release?.locked)
    return (
      <section className="content-page result-page" aria-live="polite">
        <span className="eyebrow blue">RANKINGS ARE LOCKED</span>
        <Clock size={48} aria-hidden="true" />
        <h1>The leaderboard opens after your {release.codingMinutes || 15} minutes.</h1>
        <p>
          Submitting early locks in your code. Rankings stay hidden until your full coding period
          ends.
        </p>
        {release.availableAt ? (
          <p>
            Available at <strong>{new Date(release.availableAt).toLocaleTimeString()}</strong>. This
            page checks automatically.
          </p>
        ) : (
          <p>
            Sign in with your participant code to check your leaderboard availability. Public
            rankings open after the organizer closes the round and all timers end.
          </p>
        )}
        <Link href={release.availableAt ? "/result" : "/login"} className="button primary">
          {release.availableAt ? "Submission status" : "Participant login"}
          <ArrowRight />
        </Link>
      </section>
    );
  return (
    <section className="content-page">
      <div className="page-heading leaderboard-heading">
        <div>
          <span className="eyebrow blue">ACCURACY FIRST. ALWAYS.</span>
          <h1>
            The <span>leaderboard.</span>
          </h1>
          <p>Individual brilliance. Ranked by accuracy, then by time.</p>
        </div>
        <span className="update-pill">
          <span className="live-dot" /> UPDATES EVERY 10s
        </span>
      </div>
      <div className="leaderboard-toolbar">
        <span>
          <Trophy size={20} /> {rows.length} evaluated participants
        </span>
        <input
          aria-label="Search participants"
          placeholder="Search name or team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>RANK</th>
              <th>PARTICIPANT</th>
              <th>TEAM</th>
              <th>ACCURACY</th>
              <th>COMPLETION TIME</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => (r.name + " " + r.team).toLowerCase().includes(query.toLowerCase()))
              .map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={r.rank <= 3 ? "rank top-rank" : "rank"}>
                      {String(r.rank).padStart(2, "0")}
                    </span>
                  </td>
                  <td>
                    <span className="avatar">{r.name.slice(0, 2).toUpperCase()}</span>
                    {r.name}
                  </td>
                  <td>{r.team}</td>
                  <td>
                    <strong className="score">
                      {r.score.toFixed(2)}
                      <small>%</small>
                    </strong>
                  </td>
                  <td className="mono">{time(r.completionMs)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading ? (
          <div className="empty-state loading-block">Loading rankings…</div>
        ) : error ? (
          <div className="empty-state error">{error}</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <Trophy size={40} />
            <h3>The first place is still yours to take.</h3>
            <p>Rankings appear here after submissions are evaluated.</p>
            <Link href="/login" className="text-link">
              Take the challenge <ArrowUpRight />
            </Link>
          </div>
        ) : null}
      </div>
      <p className="table-note">
        <ShieldCheck size={16} /> Scores are out of 100. Time is used only when accuracy scores are
        tied.
      </p>
    </section>
  );
}
function Result() {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let finished = false;
      try {
        const data = await api<State>("result");
        if (!active) return;
        setState(data);
        setError("");
        finished = data.submission?.status === "RESULT";
      } catch (e) {
        if (active) setError((e as Error).message);
      }
      if (active && !finished) timer = setTimeout(load, 4000);
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  const s = state?.submission;
  return (
    <section className="result-page">
      <span className="eyebrow blue">YOUR CHALLENGE</span>
      {error ? (
        <>
          <h1>Let’s get you signed in.</h1>
          <p className="error">{error}</p>
          <Link href="/login" className="button primary">
            Participant login <ArrowRight />
          </Link>
        </>
      ) : !state ? (
        <div className="loading-block">Loading your result…</div>
      ) : !s ? (
        <>
          <h1>{state.phase === "EXPIRED" ? "Time’s up." : "Your story is still unwritten."}</h1>
          <p>
            {state.phase === "EXPIRED"
              ? "No final submission was received before the deadline."
              : "Complete your contest to see your individual result."}
          </p>
          <Link
            className="button primary"
            href={state.phase === "EXPIRED" ? "/leaderboard" : "/contest"}
          >
            Continue <ArrowRight />
          </Link>
        </>
      ) : s.status === "RESULT" ? (
        <motion.div {...reveal}>
          <span className="success-icon">
            <Check size={30} />
          </span>
          <h1>You trusted your memory.</h1>
          <p>
            {state.participant.name} <span>·</span> {state.participant.team}
          </p>
          <div className="result-score">
            {s.score?.toFixed(2)}
            <span>%</span>
          </div>
          <span className="eyebrow">FINAL ACCURACY</span>
          <p>Your leaderboard unlocks after your full {state.contest?.codingMinutes || 15}-minute coding period ends.</p>
          <div className="score-breakdown">
            {[
              ["Functional", s.functional, 50],
              ["Structure", s.structure, 30],
              ["Compilation", s.syntax, 20],
            ].map(([label, value, max]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>
                  {value} <small>/ {max}</small>
                </strong>
              </div>
            ))}
          </div>
          <p>
            Completion time <strong>{time(s.completionMs)}</strong>
          </p>
          <Link className="button primary" href="/leaderboard">
            Find your place <ArrowUpRight />
          </Link>
        </motion.div>
      ) : (
        <>
          <span className="success-icon">
            <Check size={30} />
          </span>
          <h1>Submission received.</h1>
          <p>
            The leaderboard becomes available only after your full {state.contest?.codingMinutes || 15}-minute coding period ends,
            even when you submit early.
          </p>
          <p>
            {s.status === "ERROR"
              ? "The judge encountered an issue. Contact your organizer; your submission is safely stored."
              : "Your code is safely locked in. The judge will take it from here."}
          </p>
          <div className="judging-track">
            <span className="live-dot" />
            {s.status === "JUDGING"
              ? "EVALUATING YOUR CODE"
              : s.status === "ERROR"
                ? "JUDGE NEEDS ATTENTION"
                : "IN THE JUDGING QUEUE"}
          </div>

          <Link href="/leaderboard" className="text-link">
            Explore leaderboard <ArrowUpRight />
          </Link>
        </>
      )}
    </section>
  );
}
function Admin() {
  const [review, setReview] = useState<any>(null);
  const [data, setData] = useState<any>(null),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [tab, setTab] = useState("monitor"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api("admin/overview")
        .then(setData)
        .catch((e) => {
          if (!e.message.includes("authentication")) setError(e.message);
        }),
    [],
  );
  useEffect(() => {
    load();
    const i = setInterval(load, 10000);
    return () => clearInterval(i);
  }, [load]);
  if (!data)
    return (
      <section className="admin-login">
        <span className="eyebrow blue">ORGANIZER ACCESS</span>
        <h1>
          Behind the <span>challenge.</span>
        </h1>
        <form
          className="entry-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              await api("admin/login", "POST", { password });
              await load();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label htmlFor="password">ADMIN PASSWORD</label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <button className="button primary full">
            Enter dashboard <ArrowRight />
          </button>
        </form>
      </section>
    );
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-page admin-page">
      <div className="page-heading">
        <span className="eyebrow blue">CONTEST CONTROL</span>
        <h1>
          Mission <span>control.</span>
        </h1>
        <p>Every participant. Every phase. All in one place.</p>
      </div>
      <button
        className="text-button sign-out"
        onClick={async () => {
          await api("auth/logout", "POST", {});
          setData(null);
          setPassword("");
        }}
      >
        Sign out <SignOut size={16} />
      </button>
      {review && (
        <section className="submission-review" aria-label="Submitted code review">
          <div>
            <h2>Final submission</h2>
            <button className="text-button" onClick={() => setReview(null)}>
              Close review
            </button>
          </div>
          <p>
            {review.status} · {review.score ?? "Pending"} / 100
          </p>
          {review.error && <p className="error">{review.error}</p>}
          <pre>{review.source || "(Empty submission)"}</pre>
        </section>
      )}
      {data.productionStoreConfigured === false && (
        <p role="status" className="error">
          The production PostgreSQL database is not configured. Configure it before opening this
          event.
        </p>
      )}
      <div className="admin-stats">
        {[
          ["Participants", data.participants.length],
          ["Viewing", data.participants.filter((p: any) => p.phase === "VIEWING").length],
          ["Coding", data.participants.filter((p: any) => p.phase === "CODING").length],
          ["Submitted", data.submissions.length],
          ["Evaluated", data.submissions.filter((s: any) => s.status === "RESULT").length],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="admin-tabs">
        {["monitor", "teams", "contest", "submissions"].map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => {
              setTab(t);
              setMessage("");
              setError("");
            }}
          >
            {t === "monitor"
              ? "Live monitor"
              : t === "teams"
                ? "Team management"
                : t === "contest"
                  ? "Contest settings"
                  : "Submissions"}
          </button>
        ))}
        <button
          className="export-button"
          onClick={() =>
            action(async () => {
              const { rows } = await api("admin/export");
              const csv = [
                ["Rank", "Participant", "Team", "Accuracy", "Time"],
                ...rows.map((r: Row) => [r.rank, r.name, r.team, r.score, time(r.completionMs)]),
              ]
                .map((row) =>
                  row
                    .map(
                      (v: unknown) =>
                        '"' +
                        String(v)
                          .replace(/^[=+@-]/, "'")
                          .replaceAll('"', '""') +
                        '"',
                    )
                    .join(","),
                )
                .join("\n");
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
              a.download = "blind-coding-results.csv";
              a.click();
              URL.revokeObjectURL(a.href);
            })
          }
        >
          <Download /> Export results
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p className="success-message">{message}</p>}
      {tab === "monitor" ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PARTICIPANT</th>
                <th>TEAM</th>
                <th>BRANCH</th>
                <th>CODE</th>
                <th>PHASE</th>
              </tr>
            </thead>
            <tbody>
              {data.participants.map((p: any) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.team}</td>
                  <td>{p.branch || "—"}</td>
                  <td className="mono">{p.code}</td>
                  <td>
                    <span className={"phase-badge " + p.phase.toLowerCase()}>{p.phase}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.participants.length && (
            <div className="empty-state">
              <Users size={36} />
              <h3>A fresh starting line.</h3>
              <p>Create your first team to add participants.</p>
            </div>
          )}
        </div>
      ) : tab === "teams" ? (
        <form
          className="admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const form = e.currentTarget;
            action(async () => {
              const r = await api("admin/teams", "POST", { name: f.get("team") });
              setMessage(`Team ${r.team.name} created. Students can now register with this team name and their own name.`);
              form.reset();
            });
          }}
        >
          <h2>Create a team.</h2>
          <p>Students choose this team name and register themselves with their own name.</p>
          <label>
            TEAM NAME
            <input name="team" placeholder="Code Warriors" required maxLength={100} />
          </label>
          <button className="button primary" disabled={busy}>
            <Plus /> Create team
          </button>
        </form>
      ) : tab === "submissions" ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PARTICIPANT</th>
                <th>STATUS</th>
                <th>SCORE</th>
                <th>CODE REVIEW</th>
              </tr>
            </thead>
            <tbody>
              {data.submissions.map((submission: any) => (
                <tr key={submission.id}>
                  <td>
                    {data.participants.find((p: any) => p.id === submission.participantId)?.name ||
                      "Participant"}
                  </td>
                  <td>{submission.status}</td>
                  <td>{submission.score ?? "—"}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() =>
                        action(async () => {
                          const detail = await api("admin/submission", "POST", {
                            id: submission.id,
                          });
                          setReview(detail);
                        })
                      }
                    >
                      Review submitted code
                    </button>
                    {submission.status === "ERROR" && (
                      <button
                        className="text-button"
                        onClick={() =>
                          action(async () => {
                            await api("admin/retry", "POST", { id: submission.id });
                            setMessage("Submission requeued for judging.");
                          })
                        }
                      >
                        Retry judge
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.submissions.length && (
            <div className="empty-state">No final submissions received yet.</div>
          )}
        </div>
      ) : (
        <form
          key={data.contest?.id}
          className="admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            action(async () => {
              let tests;
              try {
                tests = JSON.parse(String(f.get("tests")));
              } catch {
                throw new Error("Test cases must be valid JSON.");
              }
              await api("admin/contest", "POST", {
                name: f.get("name"),
                source: f.get("source"),
                status: f.get("status"),
                readingMinutes: Number(f.get("readingMinutes")),
                codingMinutes: Number(f.get("codingMinutes")),
                tests,
              });
              setMessage("Contest settings saved.");
            });
          }}
        >
          <h2>Set the challenge.</h2>
          <div className="three-inputs">
            <label>
              READING TIME (MINUTES)
              <input
                name="readingMinutes"
                type="number"
                min={1}
                step={1}
                defaultValue={data.contest?.readingMinutes ?? 5}
                required
              />
            </label>
            <label>
              BLIND CODING TIME (MINUTES)
              <input
                name="codingMinutes"
                type="number"
                min={1}
                step={1}
                defaultValue={data.contest?.codingMinutes ?? 15}
                required
              />
            </label>
            <label>
              LANGUAGE
              <input value="C" readOnly />
            </label>
          </div>
          <div className="two-inputs">
            <label>
              CONTEST NAME
              <input
                name="name"
                required
                defaultValue={data.contest?.name || "Blind Coding 2026"}
              />
            </label>
            <label>
              STATUS
              <select name="status" defaultValue={data.contest?.status || "DRAFT"}>
                <option>DRAFT</option>
                <option>OPEN</option>
                <option>CLOSED</option>
              </select>
            </label>
          </div>
          <p>
            Reading and blind coding times apply to new attempts when saved. Participants who have
            already started keep the deadlines assigned to their attempt. Source and test cases
            lock after the first attempt starts. Closing prevents new starts; existing timers continue.
          </p>
          <label>
            C SOURCE CODE
            <textarea
              name="source"
              required
              defaultValue={data.contest?.source || ""}
              rows={14}
              spellCheck={false}
            />
          </label>
          <label>
            TEST CASES · JSON ARRAY
            <textarea
              name="tests"
              required
              rows={8}
              defaultValue={JSON.stringify(
                data.contest?.tests || [{ input: "5\n", output: "15", points: 1 }],
                null,
                2,
              )}
            />
          </label>
          <button className="button primary" disabled={busy}>
            Save contest <Check />
          </button>
        </form>
      )}
    </section>
  );
}
