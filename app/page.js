import { Drawpad } from "./components/Drawpad";
import { BACKGROUND, COLORS, ERASER, HEIGHT, SIZES, WIDTH } from "./lib/board";

// Rendered per request on the deployment's server, which also holds the drawing itself.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Drawpad",
  description:
    "A drawing pad everyone shares. Draw, and everyone on the page sees it live.",
};

export default function Page() {
  return (
    <Drawpad
      width={WIDTH}
      height={HEIGHT}
      colors={COLORS}
      background={BACKGROUND}
      eraser={ERASER}
      sizes={SIZES}
      deployment={process.env.ORBIT_DEPLOYMENT_ID ?? "local"}
    />
  );
}
