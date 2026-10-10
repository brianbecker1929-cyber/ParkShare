// Review the exact shared premium car renderer in six typical booking cases.
// This is a preview-only gallery; no Supabase access, email, Stripe or bookings.
import { drivewayCarDataUrl, getDrivewayVehicleSpec } from "../src/lib/drivewayCar.js";
import { renderParkingSpotImage } from "./_driveway-image.js";

export const DEMO_VEHICLES = [
  { vehicle_make: "BMW", vehicle_model: "X4", vehicle_colour: "Silver", label: "Silver BMW X4", expected: "suv" },
  { vehicle_make: "Lexus", vehicle_model: "LC", vehicle_colour: "Orange", label: "Orange Lexus LC", expected: "coupe" },
  { vehicle_make: "Honda", vehicle_model: "Civic", vehicle_colour: "Black", label: "Black Honda Civic", expected: "sedan" },
  { vehicle_make: "MINI", vehicle_model: "Cooper", vehicle_colour: "White", label: "White MINI Cooper", expected: "hatchback" },
  { vehicle_make: "Ford", vehicle_model: "F-150", vehicle_colour: "Red", label: "Red Ford F-150", expected: "pickup" },
  { vehicle_make: "Toyota", vehicle_model: "Sienna", vehicle_colour: "Blue", label: "Blue Toyota Sienna", expected: "van" },
];

// Plain browser-safe HTML; source image assets all come from fixed catalog
// values and are encoded into data URLs. No user-supplied HTML is included.
export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") return res.status(404).end("Not found");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Method not allowed");
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    const cards = await Promise.all(DEMO_VEHICLES.map(async car => {
      const topView = drivewayCarDataUrl(car);
      const diagram = await renderParkingSpotImage([false, true, false, false], 1, car);
      const spec = getDrivewayVehicleSpec(car);
      return `<article>
        <div class="vehicle">
          <img src="${topView}" width="104" height="204" alt="Top-down ${car.label}" />
          <div><h2>${car.label}</h2><p>${spec.bodyType.toUpperCase()} · ${car.vehicle_colour}</p>
          <small>Example profile vehicle, dynamically rendered using the same car artwork as the booking views and email PNG.</small></div>
        </div>
        <img class="map" src="data:image/png;base64,${diagram.toString("base64")}" alt="Spot B reserved for a ${car.label}" />
      </article>`;
    }));
    return res.status(200).send(`<!doctype html><html lang="en"><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>ParkShare · Premium top-down vehicle preview</title>
      <style>
        *{box-sizing:border-box}body{margin:0;background:#faf8f2;color:#0e1b2e;font-family:Arial,Helvetica,sans-serif}
        header{background:#0e1b2e;color:white;padding:22px 18px;border-bottom:5px solid #ffc107;text-align:center}
        h1{font-size:23px;line-height:1.3;margin:0 0 5px}header p{margin:0;color:#e9e2d0}
        main{max-width:1050px;margin:22px auto;padding:0 14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,295px),1fr));gap:19px}
        article{border:1px solid #e1dccc;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 2px 12px #0e1b2e17}
        .vehicle{display:flex;align-items:center;gap:20px;padding:14px;background:#fff8e1;border-bottom:1px solid #e1dccc;min-height:226px}
        .vehicle img{width:96px;height:188px;object-fit:contain;flex-shrink:0}
        .vehicle h2{font-size:18px;margin:0 0 6px}.vehicle p{font-size:13px;margin:0 0 9px;font-weight:700;color:#6b665c}
        .vehicle small{color:#6b665c;line-height:1.5}
        .map{display:block;width:100%;height:auto;max-width:360px;margin:0 auto;padding:12px}
        footer{text-align:center;padding:14px 16px 30px;color:#71695a;font-size:13px}
      </style></head><body>
      <header><h1>ParkShare · Premium Vehicle Preview</h1><p>SAMPLE VEHICLES ONLY · NO BOOKINGS OR EMAILS SENT</p></header>
      <main>${cards.join("")}</main>
      <footer>Body class and colour are automatically resolved from the selected vehicle snapshot. Exact factory model likeness is not guaranteed.</footer>
    </body></html>`);
  } catch (error) {
    console.error("Premium vehicle preview failed:", error);
    return res.status(500).end("Could not render sample vehicle gallery");
  }
}
