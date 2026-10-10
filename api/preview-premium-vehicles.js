// Review the six APPROVED high-detail image assets, including the actual
// vehicle colour selected for a booking. Preview-only; no payment or email.
import { premiumVehicleSpec } from "../src/lib/premiumVehicle.js";
import { premiumVehicleBuffer } from "./_premium-vehicle.js";
import { renderParkingSpotImage } from "./_driveway-image.js";

export const DEMO_VEHICLES = [
  { vehicle_make: "BMW", vehicle_model: "X4", vehicle_colour: "Silver", label: "Silver BMW X4", expected: "suv" },
  { vehicle_make: "Lexus", vehicle_model: "LC", vehicle_colour: "Orange", label: "Orange Lexus LC", expected: "coupe" },
  { vehicle_make: "Honda", vehicle_model: "Civic", vehicle_colour: "Black", label: "Black Honda Civic", expected: "sedan" },
  { vehicle_make: "MINI", vehicle_model: "Cooper", vehicle_colour: "White", label: "White MINI Cooper", expected: "hatchback" },
  { vehicle_make: "Ford", vehicle_model: "F-150", vehicle_colour: "Red", label: "Red Ford F-150", expected: "pickup" },
  { vehicle_make: "Toyota", vehicle_model: "Sienna", vehicle_colour: "Blue", label: "Blue Toyota Sienna", expected: "van" },
];

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
      const [photo, diagram] = await Promise.all([
        premiumVehicleBuffer(car),
        renderParkingSpotImage([false, true, false, false], 1, car),
      ]);
      const spec = premiumVehicleSpec(car);
      return `<article>
        <div class="vehicle">
          <img src="data:image/webp;base64,${photo.toString("base64")}" width="210" alt="Detailed top-down ${car.label}" />
          <div><h2>${car.label}</h2><p>${spec.bodyType.toUpperCase()} · ${car.vehicle_colour}</p>
          <small>Based on your approved high-detail vehicle library.</small></div>
        </div>
        <h3>In the reserved parking space</h3>
        <img class="map" src="data:image/png;base64,${diagram.toString("base64")}" alt="Spot B reserved for a ${car.label}" />
      </article>`;
    }));
    return res.status(200).send(`<!doctype html><html lang="en"><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>ParkShare · Approved realistic vehicle asset library</title>
      <style>
        *{box-sizing:border-box}
        body{margin:0;background:#faf8f2;color:#0e1b2e;font-family:Arial,Helvetica,sans-serif}
        header{background:#0e1b2e;color:white;padding:22px 18px;border-bottom:5px solid #ffc107;text-align:center}
        h1{font-size:23px;line-height:1.3;margin:0 0 5px}header p{margin:0;color:#e9e2d0}
        main{max-width:1030px;margin:22px auto;padding:0 14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:22px}
        article{border:1px solid #e1dccc;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 2px 12px #0e1b2e17}
        .vehicle{display:flex;align-items:center;gap:17px;padding:17px;background:#fff8e1;border-bottom:1px solid #e1dccc;min-height:240px}
        .vehicle img{width:42%;max-width:195px;height:230px;object-fit:contain;flex-shrink:0;filter:drop-shadow(0 6px 5px #14283b28)}
        .vehicle h2{font-size:19px;margin:0 0 6px}.vehicle p{font-size:13px;margin:0 0 9px;font-weight:700;color:#6b665c}
        .vehicle small{color:#6b665c;line-height:1.5}
        h3{text-align:center;margin:15px 0 0;font-size:15px;color:#15253b}
        .map{display:block;width:100%;height:auto;max-width:370px;margin:0 auto;padding:14px}
        footer{text-align:center;padding:14px 16px 30px;color:#71695a;font-size:13px}
      </style></head><body>
      <header><h1>ParkShare · Approved Realistic Vehicle Library</h1><p>SAMPLE VEHICLES ONLY · NO BOOKINGS OR EMAILS SENT</p></header>
      <main>${cards.join("")}</main>
      <footer>Actual booked vehicle body style and colour are derived from its saved reservation snapshot. Colours besides the six approved originals are recoloured variants of the same artwork.</footer>
    </body></html>`);
  } catch (error) {
    console.error("Approved vehicle gallery preview failed:", error);
    return res.status(500).end("Could not render vehicle gallery");
  }
}
