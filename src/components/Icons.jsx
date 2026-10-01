// Central inline icon set — stroke style, inherits currentColor.

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const wrap = (children, size = 22) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...base}>
    {children}
  </svg>
)

export const icons = {
  engine: (s) =>
    wrap(
      <>
        <path d="M7 4h6M10 4v3" />
        <path d="M4 10h3l2-3h6l3 3h2v4l-2 2v3h-3l-2 2H8l-2-2H4v-6l2-2z" />
        <circle cx="13" cy="12.5" r="2.2" />
      </>,
      s,
    ),
  plug: (s) =>
    wrap(
      <>
        <path d="M9 3v5M15 3v5" />
        <path d="M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8z" />
        <path d="M12 17v4" />
      </>,
      s,
    ),
  brake: (s) =>
    wrap(
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
        <path d="M12 4v3M12 17v3M4 12h3M17 12h3" />
      </>,
      s,
    ),
  shock: (s) =>
    wrap(
      <>
        <path d="M12 3v3M8 6h8l-2 3h4l-2 3h4l-2 3H8l-2-3h4L8 9h4L8 6z" transform="translate(0 1)" />
        <path d="M12 17v4" />
      </>,
      s,
    ),
  snow: (s) =>
    wrap(
      <>
        <path d="M12 3v18M4 7l16 10M20 7L4 17" />
        <path d="M12 6l-2-2M12 6l2-2M12 18l-2 2M12 18l2 2" />
      </>,
      s,
    ),
  bolt: (s) => wrap(<path d="M13 3 5 13h5l-1 8 8-10h-5l1-8z" />, s),
  tyre: (s) =>
    wrap(
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 4v3.5M12 16.5V20M4 12h3.5M16.5 12H20M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M17.7 6.3l-2.5 2.5M8.8 15.2l-2.5 2.5" />
      </>,
      s,
    ),
  phone: (s) =>
    wrap(
      <path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
      s,
    ),
  truck: (s) =>
    wrap(
      <>
        <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
        <circle cx="7.5" cy="17.5" r="1.8" />
        <circle cx="17.5" cy="17.5" r="1.8" />
      </>,
      s,
    ),
  whatsapp: (s = 18) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2a9.9 9.9 0 0 0-8.57 14.87L2 22l5.28-1.38A9.9 9.9 0 1 0 12.04 2zm0 1.8a8.1 8.1 0 1 1-4.1 15.1l-.3-.18-3.03.8.8-2.95-.19-.31A8.1 8.1 0 0 1 12.04 3.8zm-3.3 4.06c-.18 0-.47.07-.72.34-.24.27-.94.92-.94 2.24 0 1.32.96 2.6 1.1 2.78.13.18 1.86 2.98 4.6 4.06 2.28.9 2.74.72 3.24.68.5-.05 1.6-.66 1.82-1.3.23-.63.23-1.17.16-1.29-.07-.11-.25-.18-.53-.31s-1.6-.79-1.85-.88c-.25-.09-.43-.14-.61.13-.18.27-.7.9-.86 1.08-.16.18-.32.2-.6.07-.27-.14-1.12-.42-2.14-1.33-.79-.71-1.32-1.58-1.48-1.85-.16-.27-.02-.42.12-.55.12-.12.27-.31.4-.47.14-.16.18-.27.28-.45.09-.18.04-.34-.02-.47-.07-.14-.62-1.5-.85-2.05-.22-.53-.45-.46-.61-.47l-.52-.01z" />
    </svg>
  ),
  arrow: (s = 18) => wrap(<path d="M5 12h14M13 6l6 6-6 6" />, s),
  arrowDown: (s = 18) => wrap(<path d="M12 5v14M6 13l6 6 6-6" />, s),
  check: (s = 16) => wrap(<path d="M4 12.5 9.5 18 20 6.5" />, s),
  pin: (s = 20) =>
    wrap(
      <>
        <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </>,
      s,
    ),
  clock: (s = 20) =>
    wrap(
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3.5 2" />
      </>,
      s,
    ),
  mail: (s = 20) =>
    wrap(
      <>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
        <path d="m4.5 7 7.5 6 7.5-6" />
      </>,
      s,
    ),
  shield: (s = 22) =>
    wrap(
      <>
        <path d="M12 3.5 5 6v5.5c0 4.5 3 7.8 7 9 4-1.2 7-4.5 7-9V6l-7-2.5z" />
        <path d="m9 11.5 2.2 2.3L15.5 9" />
      </>,
      s,
    ),
  tag: (s = 22) =>
    wrap(
      <>
        <path d="M3.5 12.5 12 4h7.5v7.5L11 20a1.7 1.7 0 0 1-2.4 0l-5-5a1.7 1.7 0 0 1 0-2.5z" />
        <circle cx="15.5" cy="8.5" r="1.4" />
      </>,
      s,
    ),
  wrench: (s = 22) =>
    wrap(
      <path d="M14.5 6.5a4.5 4.5 0 0 0-5.7 5.7L4 17v3h3l4.8-4.8a4.5 4.5 0 0 0 5.7-5.7L14.6 12l-2.6-2.6 2.5-2.9z" />,
      s,
    ),
  menu: (s = 24) => wrap(<path d="M4 7h16M4 12h16M4 17h16" />, s),
  close: (s = 24) => wrap(<path d="M6 6l12 12M18 6 6 18" />, s),
  play: (s = 22) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  ),
  star: (s = 16) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9 2.9-6z" />
    </svg>
  ),
  chevron: (s = 18) => wrap(<path d="m6 9 6 6 6-6" />, s),
}

export default icons
