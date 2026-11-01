/** A static diagram of cards moving forward, with no simulated product controls. */
export function ForwardTogetherIllustration() {
  return (
    <svg
      className="auth-entry-illustration"
      viewBox="0 0 400 340"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Three open lanes, rather than a miniature application window. */}
      <path d="M18 28H122V312H18z" className="auth-art-lane" />
      <path d="M148 28H252V312H148z" className="auth-art-lane" />
      <path d="M278 28H382V312H278z" className="auth-art-lane" />
      <path
        d="M38 49H102M168 49H232M298 49H362"
        className="auth-art-rule"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect
        x="30"
        y="193"
        width="80"
        height="82"
        rx="8"
        className="auth-art-card"
      />
      <rect
        x="160"
        y="132"
        width="80"
        height="82"
        rx="8"
        className="auth-art-card"
      />
      <rect
        x="290"
        y="72"
        width="80"
        height="82"
        rx="8"
        className="auth-art-card"
      />
      <path
        d="M70 234C125 234 122 173 200 173S274 113 330 113"
        className="auth-art-route"
        strokeWidth="2"
        strokeDasharray="3 7"
        strokeLinecap="round"
      />
      <circle cx="70" cy="234" r="5" className="auth-art-node" />
      <circle cx="330" cy="113" r="5" className="auth-art-node" />
      <g transform="rotate(-7 200 172)">
        <rect
          x="142"
          y="120"
          width="116"
          height="104"
          rx="10"
          fill="var(--color-primary-solid)"
        />
        <path
          d="M177 189L219 147M191 147H219V175"
          stroke="white"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M158 137H173"
          stroke="white"
          strokeOpacity=".55"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <path
        d="M290 220H370M290 232H344M30 112H110M30 124H84"
        className="auth-art-rule"
        strokeLinecap="round"
      />
    </svg>
  );
}
