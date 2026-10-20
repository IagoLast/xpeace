import { ImageResponse } from "next/og";

export const alt =
  "Block por nabo 🫜 — xpeace ha marcado una respuesta como ofensiva y ha silenciado a su autor en X.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const green = "#a3d9ae";
const ink = "#172b1c";

// next/og draws emoji with Twemoji 14, which predates 🫜, so the turnip is drawn by hand.
function Turnip() {
  return (
    <svg width="380" height="460" viewBox="0 0 380 460">
      <path
        d="M190 170C170 110 120 60 60 50c10 60 60 110 120 125"
        fill="#3f8f4f"
        stroke={ink}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      <path
        d="M190 170c20-60 70-110 130-120-10 60-60 110-120 125"
        fill="#3f8f4f"
        stroke={ink}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      <path
        d="M190 175c-6-60 0-120 20-160 22 40 16 110-12 160"
        fill="#5aac68"
        stroke={ink}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      <path
        d="M190 170c-95 0-150 60-150 130 0 70 70 110 150 155 80-45 150-85 150-155 0-70-55-130-150-130z"
        fill="#f6f1f4"
        stroke={ink}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      <path
        d="M190 170c-95 0-150 60-150 130 0 8 1 16 3 23 40-35 95-40 147-40s107 5 147 40c2-7 3-15 3-23 0-70-55-130-150-130z"
        fill="#9b4f96"
        stroke={ink}
        strokeWidth="8"
        strokeLinejoin="round"
      />
      <path
        d="M118 330c20 30 45 50 72 66m72-66c-20 30-45 50-72 66"
        fill="none"
        stroke="#d9cdd6"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M140 280l30 10m70-10l-30 10"
        fill="none"
        stroke={ink}
        strokeWidth="10"
        strokeLinecap="round"
      />
      <circle cx="160" cy="312" r="10" fill={ink} />
      <circle cx="220" cy="312" r="10" fill={ink} />
      <path
        d="M168 360c14-10 30-10 44 0"
        fill="none"
        stroke={ink}
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d="M190 455v-14"
        fill="none"
        stroke={ink}
        strokeWidth="8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 80px",
          background: green,
          color: ink,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", width: 640 }}>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              padding: "10px 22px",
              borderRadius: 999,
              background: ink,
              color: green,
              fontSize: 30,
              letterSpacing: 2,
            }}
          >
            BPN · xpeace
          </div>
          <div
            style={{
              marginTop: 32,
              fontSize: 112,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: -4,
            }}
          >
            Block por nabo
          </div>
          <div style={{ marginTop: 32, fontSize: 40, lineHeight: 1.3 }}>
            Respuesta marcada como ofensiva. Autor silenciado en X.
          </div>
        </div>
        <Turnip />
      </div>
    ),
    size,
  );
}
