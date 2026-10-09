// Icons from the design file (24×24, stroked).
const PATHS = {
  check: <path d="M5 12l5 5 9-10" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chev: <path d="M9 5l7 7-7 7" />,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
  shieldCheck: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  msg: <path d="M4 5h16v11H9l-5 4V5z" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4z" />,
  warn: <path d="M12 3l10 18H2L12 3zM12 10v5M12 18h.01" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  wifi: <path d="M2 9a15 15 0 0 1 20 0M5 12.5a10.5 10.5 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  octagon: <path d="M7 2h10l5 5v10l-5 5H7l-5-5V7l5-5z" />,
  personCheck: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6" />
      <path d="M16 11l2 2 4-4" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6" />
      <path d="M16 5.5a3 3 0 0 1 0 5.5M18 14.5c2 .8 3 2.8 3 5.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  search: <path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM21 21l-4.5-4.5" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  inbox: <path d="M4 5h16v11H9l-5 4V5z" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
    </>
  ),
  speaker: <path d="M4 9v6h4l5 4V5L8 9H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />,
  share: <path d="M12 3v13M7 8l5-5 5 5M5 14v6h14v-6" />,
  video: (
    <>
      <rect x="3" y="7" width="12" height="10" rx="2" />
      <path d="M15 11l6-3v8l-6-3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  rupee: <path d="M7 4h10M7 8h10M7 4c5 0 7 2 7 5s-2 5-7 5l7 6" />,
  flag: <path d="M5 21V4h11l-2 4 2 4H5" />,
  hangup: <path d="M3 14a16 16 0 0 1 18 0l-1.5 3-4-1v-3a10 10 0 0 0-7 0v3l-4 1L3 14z" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size, style }: { name: IconName; size?: number; style?: React.CSSProperties }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" style={size ? { width: size, height: size, ...style } : style}>
      {PATHS[name]}
    </svg>
  );
}
