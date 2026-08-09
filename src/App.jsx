import { useState, useEffect, useRef, Component } from "react";
import { GoogleMap, useJsApiLoader, OverlayView, DrawingManager, Rectangle, Marker } from "@react-google-maps/api";
import { supabase } from "./lib/supabaseClient";

// Palette: official ParkShare brand — navy (#0E1B2E) and amber (#FFC107),
// the same pair used in the logo/app icon and Parker's uniform. Warm
// neutrals and moss/hazard stay as supporting accents for status states.
const C = {
  navy: "#0E1B2E", warmWhite: "#FAF7F0", concrete: "#E3DDC9",
  amber: "#FFC107", moss: "#3F7A5E", mossLight: "#E9F2ED",
  amberLight: "#FFF8E1", muted: "#71695A", white: "#fff",
  red: "#C53030", redLight: "#FFF5F5", hazard: "#E2571C",
};

// Guards the new satellite-map features (which depend on Google's Maps JS SDK
// loading correctly) so that if anything in there throws, the person sees the
// old, proven-working spot picker instead of a blank crashed page.
class SpotMapBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) { console.error("Satellite spot view crashed — falling back:", error, info); }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

const PARKER = {
  signfinal: "/parker/parker-signfinal.png",
  fullbody: "/parker/parker-fullbody.png",
  signpose: "/parker/parker-signpose.png",
  waving: "/parker/parker-waving.png",
  face: "/parker/parker-face.png",
  headset: "/parker/parker-headset.png",
  helpful: "/parker/parker-helpful.png",
  thankyou: "/parker/parker-thankyou.png",
  thinking: "/parker/parker-thinking.png",
  welcome: "/parker/parker-welcome.png",
  homeWave: "/parker/parker-home-wave.png",
  success: "/parker/parker-success.png",
  savings: "/parker/parker-savings.png",
  icon: "/parker/parker-icon.png",
};

const ESKA_LOGO = "/parker/parker-eska-logo.png";

const REVIEWS_DATA = {
  1: [
    { id: 1, user: "Tom B.", rating: 5, date: "Jun 10, 2026", text: "Perfect spot, exactly as described. Easy access and Sarah was super responsive." },
    { id: 2, user: "Maria G.", rating: 5, date: "May 28, 2026", text: "Loved it! Covered spot kept my car out of the rain. Will book again." },
    { id: 3, user: "Raj P.", rating: 4, date: "May 14, 2026", text: "Great driveway, gate code came right on time. Dock one star only because street was tricky to find." },
  ],
  2: [
    { id: 1, user: "Chen W.", rating: 5, date: "Jun 15, 2026", text: "Huge driveway, fits my SUV no problem. James was friendly and quick to reply." },
    { id: 2, user: "Aisha M.", rating: 4, date: "Jun 1, 2026", text: "Good value near the stadium. Would recommend." },
  ],
  3: [
    { id: 1, user: "Luke D.", rating: 5, date: "Jun 18, 2026", text: "Absolutely flawless. Gated and secure — exactly what I needed." },
  ],
};

const INITIAL_THREADS = {
  1: [
    { id: 1, from: "host", text: "Hi! The driveway is easy to find — just look for the blue gate.", ts: "Yesterday 10:14am" },
    { id: 2, from: "me", text: "Great, thanks! Is there a code for the gate?", ts: "Yesterday 10:20am" },
    { id: 3, from: "host", text: "Yes, I'll send it 30 min before your booking starts 👍", ts: "Yesterday 10:22am" },
  ],
  2: [
    { id: 1, from: "me", text: "Hey James, is this spot available on weekends?", ts: "Jun 20, 9:01am" },
    { id: 2, from: "host", text: "Yes, fully available! Book anytime.", ts: "Jun 20, 9:15am" },
  ],
};

// ─── Shared UI ────────────────────────────────────────────────────────────────
// Renders the host's actual first uploaded photo when there is one, falling
// back to the simple emoji icon for listings that don't have a photo yet.
function ListingThumb({ listing, size, fontSize, style }) {
  const isPhoto = typeof listing.img === "string" && listing.img.startsWith("data:");
  if (isPhoto) {
    return <img src={listing.img} alt={listing.title || "Driveway"} style={{ width: size ?? "100%", height: size ?? "100%", objectFit: "cover", ...style }} />;
  }
  return <span style={{ fontSize: fontSize ?? size, lineHeight: 1, ...style }}>{listing.img}</span>;
}

function Badge({ children, color = C.moss }) {
  return (
    <span style={{
      background: color === C.moss ? C.mossLight : C.amberLight,
      color, fontSize: 11, fontWeight: 600, padding: "2px 8px",
      borderRadius: 20, letterSpacing: "0.03em",
    }}>{children}</span>
  );
}

// Signature element: prices read like hand-stenciled curb numbers —
// a solid border and a slight hand-painted tilt, not a flat pill.
function PriceTag({ price, size = "md" }) {
  const dims = size === "sm"
    ? { pad: "2px 7px", font: 11, sub: 8 }
    : size === "lg"
      ? { pad: "6px 14px", font: 20, sub: 11 }
      : { pad: "4px 10px", font: 13, sub: 9 };
  return (
    <span style={{
      display: "inline-flex", alignItems: "baseline", gap: 2,
      background: C.warmWhite, color: C.navy, fontFamily: "'Poppins', sans-serif",
      fontWeight: 800, fontSize: dims.font, padding: dims.pad, borderRadius: 6,
      border: "2px solid " + C.navy, transform: "rotate(-1.5deg)", flexShrink: 0,
    }}>
      ${price}<span style={{ fontSize: dims.sub, fontWeight: 600, color: C.muted }}>/hr</span>
    </span>
  );
}

function Stars({ rating, size = 13 }) {
  return (
    <span style={{ color: C.amber, fontWeight: 700, fontSize: size }}>
      {"★".repeat(Math.round(rating))}{"☆".repeat(5 - Math.round(rating))}
    </span>
  );
}

// Parker as a guide, not just a mascot: a small speech-bubble callout that
// can drop into any screen with a contextual tip, nudge, or explanation.
// `pose` picks which Parker art to show (defaults to the thinking pose,
// since a tip is Parker noticing something and saying so). `circle` opts
// into a small face-focused circular crop instead of the full uncropped
// image — better for full-body art (like the sign-holding pose) shown at
// small sizes, where the whole figure just reads as visual noise.
function ParkerTip({ children, pose = "thinking", circle = false, style }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, ...style }}>
      {circle ? (
        <img src={PARKER[pose] || PARKER.thinking} alt="Parker" style={{ width: 60, height: 60, borderRadius: "50%", border: "2px solid " + C.navy, objectFit: "cover", objectPosition: "top", flexShrink: 0, background: C.amber }} />
      ) : (
        <img src={PARKER[pose] || PARKER.thinking} alt="Parker" style={{ height: 99, width: "auto", objectFit: "contain", flexShrink: 0 }} />
      )}
      <div style={{ position: "relative", background: C.navy, color: C.white, borderRadius: 14, borderTopLeftRadius: 4, padding: "10px 14px", fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 12.5, lineHeight: 1.5, flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

// ─── Valet Mascot SVG ─────────────────────────────────────────────────────────
function Btn({ children, onClick, variant = "primary", disabled, full, small }) {
  const base = {
    border: "none", borderRadius: 8, fontWeight: 700, cursor: disabled ? "default" : "pointer",
    fontFamily: "'Poppins', sans-serif", width: full ? "100%" : undefined,
    padding: small ? "8px 16px" : "12px 22px", fontSize: small ? 12 : 14,
    transition: "opacity 0.15s",
    opacity: disabled ? 0.45 : 1,
  };
  const variants = {
    primary: { background: C.navy, color: C.white },
    amber: { background: C.amber, color: C.white },
    outline: { background: "none", border: "1.5px solid "+C.navy, color: C.navy },
    ghost: { background: "none", color: C.muted },
    moss: { background: C.moss, color: C.white },
    pill: { background: C.amber, border: "2px solid "+C.white, color: C.navy, borderRadius: 20 },
  };
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant] }}>{children}</button>;
}

function Modal({ children, onClose, title }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(27,42,59,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}>
      <div style={{ background: C.white, borderRadius: 16, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", fontFamily: "'Poppins', sans-serif", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid "+C.concrete, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, color: C.navy, fontSize: 16 }}>{title}</div>
          <button onClick={onClose} style={{ background: C.concrete, border: "none", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", fontSize: 16, color: C.muted }}>×</button>
        </div>
        <div style={{ padding: "20px 22px" }}>{children}</div>
      </div>
    </div>
  );
}

// ─── Map ──────────────────────────────────────────────────────────────────────
// Great-circle distance between two lat/lng points, in miles.
function milesBetween(lat1, lng1, lat2, lng2) {
  const R = 3958.8, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const GOOGLE_MAPS_LIBRARIES = ["drawing"]; // stable array reference — required by useJsApiLoader to avoid reload loops. "drawing" powers the satellite spot-marking tool in the host listing flow.

// Muted "curbside" map styling so Google's default map matches the app's palette.
const MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#F4F1E8" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#71695A" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#FAF7F0" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#F0EBDD" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#E3DDC9" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#BBD8E8" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#E1EAD9" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

function ListingsMap({ listings, selected, onSelect, userLoc }) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const mapRef = useRef(null);

  const withCoords = listings.filter(l => typeof l.lat === "number" && typeof l.lng === "number");

  // Fit the map to show every pin (plus the user's location, if known) whenever the
  // underlying set of listings changes — e.g. after a new search or filter.
  useEffect(() => {
    if (!mapRef.current || !window.google) return;
    const pts = userLoc ? [...withCoords, userLoc] : withCoords;
    if (pts.length === 0) return;
    if (pts.length === 1) {
      mapRef.current.panTo({ lat: pts[0].lat, lng: pts[0].lng });
      mapRef.current.setZoom(14);
      return;
    }
    const bounds = new window.google.maps.LatLngBounds();
    pts.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
    mapRef.current.fitBounds(bounds, 48);
  }, [withCoords.map(l => l.id).join(","), userLoc?.lat, userLoc?.lng]);

  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
    return <div style={{ width: "100%", height: "100%", borderRadius: 12, background: "#F4F1E8", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13, textAlign: "center", padding: 16 }}>Map unavailable — missing Google Maps API key</div>;
  }
  if (loadError) {
    return <div style={{ width: "100%", height: "100%", borderRadius: 12, background: "#F4F1E8", display: "flex", alignItems: "center", justifyContent: "center", color: C.red, fontSize: 13, textAlign: "center", padding: 16 }}>Couldn't load Google Maps</div>;
  }
  if (!isLoaded) {
    return <div style={{ width: "100%", height: "100%", borderRadius: 12, background: "#F4F1E8", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }}>Loading map…</div>;
  }
  if (withCoords.length === 0 && !userLoc) {
    return <div style={{ width: "100%", height: "100%", borderRadius: 12, background: "#F4F1E8", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }}>No driveways to show on the map</div>;
  }

  const center = userLoc || (withCoords[0] ? { lat: withCoords[0].lat, lng: withCoords[0].lng } : { lat: 40.7128, lng: -74.006 });

  return (
    <div style={{ width: "100%", height: "100%", borderRadius: 12, overflow: "hidden" }}>
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: "100%" }}
        center={center}
        zoom={13}
        onLoad={(map) => { mapRef.current = map; }}
        options={{
          styles: MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        }}
      >
        {userLoc && (
          <OverlayView position={{ lat: userLoc.lat, lng: userLoc.lng }} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
            <div title="You are here" style={{ width: 16, height: 16, borderRadius: "50%", background: C.hazard, border: "3px solid #fff", boxShadow: "0 2px 8px rgba(0,0,0,0.3)", transform: "translate(-50%,-50%)" }} />
          </OverlayView>
        )}

        {withCoords.map(l => {
          const on = selected?.id === l.id;
          return (
            <OverlayView key={l.id} position={{ lat: l.lat, lng: l.lng }} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
              <button onClick={() => onSelect(l)} style={{
                transform: "translate(-50%,-100%)" + (on ? " scale(1.12)" : ""),
                background: on ? C.hazard : C.warmWhite, color: on ? "#fff" : C.navy, fontWeight: 700, fontSize: 12,
                padding: "4px 9px", borderRadius: 7, border: "2px solid " + (on ? C.hazard : C.navy),
                boxShadow: "0 2px 8px rgba(0,0,0,0.22)", whiteSpace: "nowrap", cursor: "pointer",
                fontFamily: "'Poppins', sans-serif", transition: "transform 0.15s",
              }}>${l.price}/hr</button>
            </OverlayView>
          );
        })}
      </GoogleMap>
    </div>
  );
}

// ─── Messaging Panel ──────────────────────────────────────────────────────────
function MessagingPanel({ listing, onClose, user }) {
  const numericId = String(listing.id).startsWith("db-") ? Number(String(listing.id).slice(3)) : null;
  const isRealListing = numericId !== null && user;

  const [threads, setThreads] = useState(INITIAL_THREADS);
  const [dbMsgs, setDbMsgs] = useState([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);
  const msgs = isRealListing ? dbMsgs : (threads[listing.id] || []);

  const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const loadMessages = () => {
    if (!isRealListing) return;
    supabase
      .from("messages")
      .select("*")
      .eq("listing_id", numericId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error || !data) return;
        setDbMsgs(
          data.map(row => ({
            id: row.id,
            from: row.sender_id === user.id ? "me" : "host",
            text: row.text,
            ts: fmtTime(row.created_at),
          }))
        );
      });
  };

  useEffect(() => { loadMessages(); }, [listing.id, user]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);

  const send = async () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");

    if (isRealListing) {
      const { error } = await supabase.from("messages").insert({
        listing_id: numericId,
        sender_id: user.id,
        text,
      });
      if (!error) loadMessages();
      return;
    }

    // Demo listings aren't backed by real hosts, so keep the local
    // simulated conversation (with an automatic reply) for those.
    const msg = { id: Date.now(), from: "me", text, ts: "Just now" };
    setThreads(t => ({ ...t, [listing.id]: [...(t[listing.id] || []), msg] }));
    const replies = ["Thanks for reaching out!", "Sure thing!", "Great, see you then 🙂", "The spot will be ready for you."];
    setTimeout(() => {
      setThreads(t => ({ ...t, [listing.id]: [...(t[listing.id] || []), { id: Date.now() + 1, from: "host", text: replies[Math.floor(Math.random() * replies.length)], ts: "Just now" }] }));
    }, 1400);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(27,42,59,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000, fontFamily: "'Poppins', sans-serif" }}>
      <div style={{ background: C.white, width: "100%", maxWidth: 500, borderRadius: "16px 16px 0 0", display: "flex", flexDirection: "column", maxHeight: "80vh", minHeight: 380, boxShadow: "0 -8px 40px rgba(0,0,0,0.18)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid "+C.concrete, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{listing.hostImg}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>{listing.host}</div>
            <div style={{ fontSize: 11, color: C.muted }}>Host · {listing.title}</div>
          </div>
          <button onClick={onClose} style={{ background: C.concrete, border: "none", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", fontSize: 16, color: C.muted }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          {msgs.length === 0 && <div style={{ textAlign: "center", color: C.muted, fontSize: 13, marginTop: 24 }}>No messages yet. Say hi to {listing.host}!</div>}
          {msgs.map(m => (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: m.from === "me" ? "flex-end" : "flex-start" }}>
              <div style={{ background: m.from === "me" ? C.navy : C.warmWhite, color: m.from === "me" ? C.white : C.navy, padding: "9px 14px", borderRadius: m.from === "me" ? "16px 16px 4px 16px" : "16px 16px 16px 4px", fontSize: 13, maxWidth: "75%", lineHeight: 1.45 }}>{m.text}</div>
              <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{m.ts}</div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid "+C.concrete, display: "flex", gap: 8 }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder={"Message "+listing.host+"…"}
            style={{ flex: 1, border: "1px solid "+C.concrete, borderRadius: 24, padding: "10px 16px", fontSize: 13, outline: "none", fontFamily: "'Poppins', sans-serif", color: C.navy }} />
          <button onClick={send} disabled={!input.trim()} style={{ background: input.trim() ? C.navy : C.concrete, color: input.trim() ? C.white : C.muted, border: "none", borderRadius: "50%", width: 42, height: 42, cursor: input.trim() ? "pointer" : "default", fontSize: 18, flexShrink: 0 }}>↑</button>
        </div>
      </div>
    </div>
  );
}

// ─── Payment Flow ─────────────────────────────────────────────────────────────
function PaymentModal({ listing, hours, chosenSpot, date, startHour, endHour, onClose, onSuccess, user }) {
  const [step, setStep] = useState(1); // 1=summary, 2=card, 3=processing, 4=done
  const [card, setCard] = useState({ number: "", expiry: "", cvv: "", name: "" });
  const [errors, setErrors] = useState({});
  const [stripeError, setStripeError] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const spotLabel = (i) => String.fromCharCode(65 + i);

  const numericId = String(listing.id).startsWith("db-") ? Number(String(listing.id).slice(3)) : null;
  const isRealListing = numericId !== null;

const subtotal = listing.price * hours;
  const serviceFee = Math.round(subtotal * 0.15 * 100) / 100;
  const total = subtotal + serviceFee;
  const dateLabel = date ? date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : null;
  const timeLabel = (typeof startHour === "number" && typeof endHour === "number") ? formatHour(startHour) + " – " + formatHour(endHour) : null;

  const payWithStripe = async () => {
    setStripeError("");

    if (!user) {
      setStripeError("Please sign in before booking.");
      return;
    }

    if (!isRealListing) {
      setStripeError("This parking listing is not available for Stripe checkout.");
      return;
    }

    setRedirecting(true);

    try {
      // The Stripe API is protected. Send the current Supabase JWT so the
      // server can verify which signed-in ParkShare user is making the booking.
      let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      let session = sessionData?.session;

      // Refresh an old session once before asking the user to sign in again.
      if (sessionError || !session?.access_token) {
        const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        session = refreshedData?.session;
      }

      if (!session?.access_token) {
        throw new Error("Your session is invalid or expired. Please sign in again.");
      }

      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          listingId: numericId,
          hours,
          total,
          listingTitle: listing.title,
          spotLabel: chosenSpot !== null && chosenSpot !== undefined ? spotLabel(chosenSpot) : undefined,
          bookingDate: date instanceof Date ? date.toISOString() : undefined,
          startHour,
          endHour,
        }),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // Keep the fallback error below when the API returns no JSON body.
      }

      if (res.status === 401) {
        throw new Error("Your session is invalid or expired. Please sign out and sign in again.");
      }

      if (!res.ok) {
        throw new Error(data.error || "Couldn't start Stripe checkout. Please try again.");
      }

      if (!data.url) {
        throw new Error("Stripe checkout did not return a payment link.");
      }

      window.location.assign(data.url); // hand off to Stripe's hosted checkout page
    } catch (err) {
      console.error("Stripe checkout error:", err);
      setRedirecting(false);
      setStripeError(err?.message || "Couldn't start Stripe checkout. Please try again.");
    }
  };

  const fmtCard = (v) => v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  const fmtExp = (v) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d; };

  const validate = () => {
    const e = {};
    if (card.number.replace(/\s/g, "").length < 16) e.number = "Enter a valid 16-digit card number";
    if (card.expiry.length < 5) e.expiry = "Enter expiry as MM/YY";
    if (card.cvv.length < 3) e.cvv = "Enter 3-digit CVV";
    if (!card.name.trim()) e.name = "Enter the name on your card";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const pay = () => {
    if (!validate()) return;
    setStep(3);
    setTimeout(() => setStep(4), 2000);
  };

  const inputS = (err) => ({
    width: "100%", border: "1.5px solid "+(err?C.red:C.concrete), borderRadius: 8,
    padding: "10px 14px", fontSize: 14, color: C.navy, outline: "none", boxSizing: "border-box",
    fontFamily: "'Poppins', sans-serif", background: err ? C.redLight : C.white,
  });
  const labelS = { fontSize: 12, color: C.muted, fontWeight: 600, display: "block", marginBottom: 5 };

  if (step === 4) return (
    <Modal title="Payment successful" onClose={() => { onClose(); onSuccess(); }}>
      <div style={{ textAlign: "center", padding: "10px 0 20px" }}>
        <img src={PARKER.success} alt="Parker giving thumbs up" style={{ height: 110, width: "auto", marginBottom: 6 }} />
        <h3 style={{ fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 22, marginBottom: 8 }}>You're booked!</h3>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 6 }}>
          <strong>{listing.title}</strong> · {hours} hr{hours > 1 ? "s" : ""}{chosenSpot !== null && chosenSpot !== undefined ? " · Spot " + spotLabel(chosenSpot) : ""}
        </p>
        <p style={{ color: C.amber, fontWeight: 800, fontSize: 20, marginBottom: 20 }}>${total} charged</p>
        <div style={{ background: C.mossLight, border: "1px solid "+C.moss, borderRadius: 10, padding: "12px 16px", color: C.moss, fontSize: 13, fontWeight: 600, marginBottom: 24 }}>
          📍 {listing.address}
        </div>
        <Btn onClick={() => { onClose(); onSuccess(); }} full>Back to listings</Btn>
      </div>
    </Modal>
  );

  if (step === 3) return (
    <Modal title="Processing payment…" onClose={() => {}}>
      <div style={{ textAlign: "center", padding: "30px 0" }}>
        <div style={{ fontSize: 48, marginBottom: 16, animation: "spin 1s linear infinite" }}>⏳</div>
        <p style={{ color: C.muted }}>Securing your spot…</p>
      </div>
    </Modal>
  );

  return (
    <Modal title={step === 1 ? "Review & pay" : "Payment details"} onClose={onClose}>
      {step === 1 && (
        <div>
          {/* Booking summary */}
          <div style={{ background: C.warmWhite, border: "1px solid "+C.concrete, borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, color: C.navy, marginBottom: 10 }}>Booking summary</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ListingThumb listing={listing} fontSize={32} /></div>
              <div>
                <div style={{ fontWeight: 600, color: C.navy, fontSize: 14 }}>{listing.title}</div>
                <div style={{ fontSize: 12, color: C.muted }}>📍 {listing.address}</div>
              </div>
            </div>

            {(dateLabel || timeLabel) && (
              <div style={{ background: C.mossLight, borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 13, color: C.moss, fontWeight: 700 }}>
                {dateLabel && <div>📅 {dateLabel}</div>}
                {timeLabel && <div style={{ marginTop: 2 }}>🕐 {timeLabel} ({hours} hr{hours > 1 ? "s" : ""})</div>}
              </div>
            )}
            {[
              [listing.price+"/hr × "+hours+" hr"+(hours>1?"s":""), "$"+subtotal],
              ["Service fee (15%)", "$"+serviceFee],
            ].map(([label, val]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.muted, marginBottom: 6 }}>
                <span>{label}</span><span>{val}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 16, color: C.navy, borderTop: "1px solid "+C.concrete, paddingTop: 10, marginTop: 6 }}>
              <span>Total</span><span style={{ color: C.amber }}>${total}</span>
            </div>
          </div>

{chosenSpot !== null && chosenSpot !== undefined && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, color: C.navy, marginBottom: 10 }}>Your parking spot</div>
              <div>
                <SpotPicker availableCount={Math.min(listing.spaces || 1, 4)} chosen={chosenSpot} onChoose={() => {}} spotStates={Array.isArray(listing.spots) && listing.spots.length > 0 ? Array.from({ length: 4 }, (_, i) => !!listing.spots[i]?.forRent) : undefined} />
                <div style={{ fontWeight: 800, fontSize: 20, color: C.navy, marginTop: 10 }}>Spot {spotLabel(chosenSpot)}</div>
              </div>
            </div>
          )}
          {stripeError && <div style={{ color: C.red, fontSize: 12, marginBottom: 10, textAlign: "center" }}>{stripeError}</div>}
          {isRealListing ? (
            <>
              <Btn onClick={payWithStripe} full disabled={redirecting}>
                {redirecting ? "Redirecting to secure checkout…" : "Pay with Stripe →"}
              </Btn>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, color: C.muted, marginTop: 10 }}>
                🔒 You'll enter your card on Stripe's secure checkout page
              </div>
            </>
          ) : (
            <Btn onClick={() => setStep(2)} full>Continue to payment →</Btn>
          )}
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: C.warmWhite, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: C.muted, display: "flex", justifyContent: "space-between" }}>
            <span>Total due</span><span style={{ fontWeight: 800, color: C.amber, fontSize: 16 }}>${total}</span>
          </div>

          <div>
            <label style={labelS}>Name on card</label>
            <input style={inputS(errors.name)} placeholder="Jane Smith" value={card.name} onChange={e => setCard(c => ({ ...c, name: e.target.value }))} />
            {errors.name && <div style={{ color: C.red, fontSize: 11, marginTop: 3 }}>{errors.name}</div>}
          </div>

          <div>
            <label style={labelS}>Card number</label>
            <input style={inputS(errors.number)} placeholder="1234 5678 9012 3456" value={card.number}
              onChange={e => setCard(c => ({ ...c, number: fmtCard(e.target.value) }))} maxLength={19} />
            {errors.number && <div style={{ color: C.red, fontSize: 11, marginTop: 3 }}>{errors.number}</div>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelS}>Expiry</label>
              <input style={inputS(errors.expiry)} placeholder="MM/YY" value={card.expiry}
                onChange={e => setCard(c => ({ ...c, expiry: fmtExp(e.target.value) }))} maxLength={5} />
              {errors.expiry && <div style={{ color: C.red, fontSize: 11, marginTop: 3 }}>{errors.expiry}</div>}
            </div>
            <div>
              <label style={labelS}>CVV</label>
              <input style={inputS(errors.cvv)} placeholder="123" value={card.cvv}
                onChange={e => setCard(c => ({ ...c, cvv: e.target.value.replace(/\D/g, "").slice(0, 3) }))} maxLength={3} />
              {errors.cvv && <div style={{ color: C.red, fontSize: 11, marginTop: 3 }}>{errors.cvv}</div>}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.muted, marginBottom: 4 }}>
            🔒 Payments are secure and encrypted
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Btn variant="pill" onClick={() => setStep(1)}>← Back</Btn>
            <Btn variant="amber" onClick={pay} full>Pay ${total}</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Reviews Section ──────────────────────────────────────────────────────────
function ReviewsSection({ listing, onSubmitReview, user }) {
  const numericId = String(listing.id).startsWith("db-") ? Number(String(listing.id).slice(3)) : null;
  const isRealListing = numericId !== null;

  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ rating: 5, text: "" });
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [localReviews, setLocalReviews] = useState(REVIEWS_DATA[listing.id] || []);

  const loadReviews = () => {
    if (!isRealListing) return;
    supabase
      .from("reviews")
      .select("*, profiles(name)")
      .eq("listing_id", numericId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error || !data) return;
        setLocalReviews(
          data.map(row => ({
            id: row.id,
            user: row.profiles?.name || "Renter",
            rating: row.rating,
            date: new Date(row.created_at).toLocaleDateString(),
            text: row.text,
          }))
        );
      });
  };

  useEffect(() => { loadReviews(); }, [listing.id]);

  const submit = async () => {
    if (!draft.text.trim()) return;
    setSubmitError("");

    if (isRealListing) {
      if (!user) {
        setSubmitError("Please sign in to leave a review.");
        return;
      }
      setSubmitting(true);
      const { error } = await supabase.from("reviews").insert({
        listing_id: numericId,
        user_id: user.id,
        rating: draft.rating,
        text: draft.text.trim(),
      });
      setSubmitting(false);
      if (error) {
        setSubmitError(error.message);
        return;
      }
      loadReviews();
    } else {
      // Demo listings aren't backed by a real listing row, so keep the
      // review local to this session.
      const r = { id: Date.now(), user: "You", rating: draft.rating, date: "Just now", text: draft.text.trim() };
      setLocalReviews(rs => [r, ...rs]);
    }

    setSubmitted(true);
    setShowForm(false);
    onSubmitReview?.();
  };

  const avgRating = localReviews.length
    ? (localReviews.reduce((s, r) => s + r.rating, 0) / localReviews.length).toFixed(1)
    : listing.rating;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div>
          <span style={{ fontWeight: 700, color: C.navy, fontSize: 16 }}>Reviews</span>
          <span style={{ fontSize: 13, color: C.amber, fontWeight: 700, marginLeft: 8 }}>★ {avgRating}</span>
          <span style={{ fontSize: 12, color: C.muted, marginLeft: 4 }}>({localReviews.length})</span>
        </div>
        {!showForm && !submitted && (
          <Btn small variant="outline" onClick={() => setShowForm(true)}>Write a review</Btn>
        )}
      </div>

      {showForm && (
        <div style={{ background: C.warmWhite, border: "1px solid "+C.concrete, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 6 }}>Your rating</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setDraft(d => ({ ...d, rating: n }))}
                  style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: n <= draft.rating ? C.amber : C.concrete, padding: 0 }}>★</button>
              ))}
            </div>
          </div>
          <textarea
            value={draft.text}
            onChange={e => setDraft(d => ({ ...d, text: e.target.value }))}
            placeholder="Share your experience…"
            style={{ width: "100%", border: "1px solid "+C.concrete, borderRadius: 8, padding: "10px 14px", fontSize: 13, resize: "vertical", minHeight: 80, fontFamily: "'Poppins', sans-serif", color: C.navy, outline: "none", boxSizing: "border-box" }}
          />
          {submitError && <div style={{ color: C.red, fontSize: 12, marginTop: 8 }}>{submitError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Btn small variant="ghost" onClick={() => setShowForm(false)}>Cancel</Btn>
            <Btn small variant="moss" onClick={submit} disabled={!draft.text.trim() || submitting}>{submitting ? "Submitting…" : "Submit review"}</Btn>
          </div>
        </div>
      )}

      {submitted && (
        <div style={{ background: C.mossLight, border: "1px solid "+C.moss, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: C.moss, fontWeight: 600, marginBottom: 14 }}>
          ✓ Thanks for your review!
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {localReviews.map(r => (
          <div key={r.id} style={{ background: C.white, border: "1px solid "+C.concrete, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
              <div>
                <span style={{ fontWeight: 700, color: C.navy, fontSize: 13 }}>{r.user}</span>
                <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>{r.date}</span>
              </div>
              <Stars rating={r.rating} size={12} />
            </div>
            <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, margin: 0 }}>{r.text}</p>
          </div>
        ))}
        {localReviews.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>No reviews yet. Be the first!</div>}
      </div>
    </div>
  );
}

// ─── Listing Detail ────────────────────────────────────────────────────────────
// ─── Renter-facing satellite view ──────────────────────────────────────────────
// Shows the real aerial photo of the driveway. When the host marked spots in
// step 4 of listing, they're drawn here too — tappable when used inside the
// spot picker so renters choose their exact space on the actual property.
function ListingSatelliteView({ lat, lng, spots = [], interactive = false, chosen = null, onChoose, height = 220 }) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });

  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY || typeof lat !== "number" || typeof lng !== "number" || loadError) return null;
  if (!isLoaded) {
    return <div style={{ width: "100%", height, borderRadius: 12, background: "#F4F1E8", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }}>Loading satellite photo…</div>;
  }

  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "2px solid " + C.navy, background: "#E3DDC9" }}>
      <GoogleMap
        mapContainerStyle={{ width: "100%", height }}
        center={{ lat, lng }}
        zoom={19}
        mapTypeId="satellite"
        options={{ disableDefaultUI: true, zoomControl: false, tilt: 0, clickableIcons: false, gestureHandling: interactive ? "greedy" : "none", draggable: interactive, keyboardShortcuts: false }}
      >
        {spots.length === 0 && (
          <OverlayView position={{ lat, lng }} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
            <div style={{ transform: "translate(-50%,-100%)", fontSize: 30, filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.5))" }}>📍</div>
          </OverlayView>
        )}
        {spots.map((s, i) => {
          // Label by draw order (same index the host sees in step 4, private spots
          // included) — not a rent-only recount — so "Spot C" means the same
          // physical space to both host and renter.
          const isRent = s.forRent;
          const myLabel = i;
          const isChosen = isRent && chosen === myLabel;
          return (
            <Rectangle
              key={s.id}
              bounds={s.bounds}
              options={{
                fillColor: isChosen ? C.hazard : (isRent ? SPOT_STROKE_RENT : SPOT_STROKE_PRIVATE),
                fillOpacity: isChosen ? 0.55 : 0.35,
                strokeColor: isChosen ? C.hazard : (isRent ? SPOT_STROKE_RENT : SPOT_STROKE_PRIVATE),
                strokeWeight: isChosen ? 3 : 2,
                clickable: interactive && isRent,
              }}
              onClick={isRent && interactive ? () => onChoose(myLabel) : undefined}
            />
          );
        })}
      </GoogleMap>
    </div>
  );
}
function MiniCalendar({ selected, onSelect }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [viewMonth, setViewMonth] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1));

  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const canGoBack = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1) > new Date(today.getFullYear(), today.getMonth(), 1);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button onClick={() => canGoBack && setViewMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))} disabled={!canGoBack}
          style={{ background: "none", border: "1px solid " + C.concrete, borderRadius: 8, width: 30, height: 30, cursor: canGoBack ? "pointer" : "default", opacity: canGoBack ? 1 : 0.35, color: C.navy, fontSize: 14 }}>‹</button>
        <div style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>{monthLabel}</div>
        <button onClick={() => setViewMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
          style={{ background: "none", border: "1px solid " + C.concrete, borderRadius: 8, width: 30, height: 30, cursor: "pointer", color: C.navy, fontSize: 14 }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: C.muted }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const cellDate = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d);
          const isPast = cellDate < today;
          const isChosen = isSameDay(cellDate, selected);
          const isToday = isSameDay(cellDate, today);
          return (
            <button key={i} disabled={isPast} onClick={() => onSelect(cellDate)} style={{
              aspectRatio: "1", borderRadius: 8, border: isChosen ? "2px solid " + C.hazard : isToday ? "1.5px solid " + C.moss : "1px solid " + C.concrete,
              background: isChosen ? C.hazard : isPast ? C.concrete : C.white, color: isChosen ? C.white : isPast ? C.muted : C.navy,
              fontSize: 12, fontWeight: isChosen || isToday ? 700 : 500, cursor: isPast ? "default" : "pointer", opacity: isPast ? 0.5 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Poppins', sans-serif",
            }}>{d}</button>
          );
        })}
      </div>
    </div>
  );
}
const HOUR_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 6); // 6am–11pm
const formatHour = (h) => {
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ":00 " + period;
};
function ListingDetail({ listing, onBack, onMessage, user }) {
  // "now" = Book Now (duration only, starts at payment). "advance" = Schedule
  // for Later (pick a date + time window). Two genuinely different booking
  // flows sharing one panel, not one flow pretending to be both.
  const [bookingMode, setBookingMode] = useState("now");

  // Book Now duration — quick-pick chips, falls back to a custom hour input.
  const NOW_DURATIONS = [0.5, 1, 2];
  const [nowDuration, setNowDuration] = useState(1);
  const [nowCustomHours, setNowCustomHours] = useState("3");
  const isCustomDuration = !NOW_DURATIONS.includes(nowDuration);
  const nowHours = isCustomDuration ? Math.max(0.25, Number(nowCustomHours) || 1) : nowDuration;

  // Schedule for Later — the original date + start/end hour pickers.
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(11);
  const advanceHours = Math.max(1, endHour - startHour);
  const handleStartChange = (e) => { const v = Number(e.target.value); setStartHour(v); if (endHour <= v) setEndHour(v + 1); };
  const handleEndChange = (e) => { setEndHour(Number(e.target.value)); };
  const [date, setDate] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [showCalendar, setShowCalendar] = useState(false);

  // The single source of truth for "how long, and what gets sent to
  // checkout" — depends entirely on which tab is active.
  const hours = bookingMode === "now" ? nowHours : advanceHours;

  const [showPayment, setShowPayment] = useState(false);
  const [booked, setBooked] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [chosenSpot, setChosenSpot] = useState(null);
  const [showSpotPicker, setShowSpotPicker] = useState(true);
  const hasValidBounds = (s) => s?.bounds && typeof s.bounds.north === "number" && typeof s.bounds.south === "number" && typeof s.bounds.east === "number" && typeof s.bounds.west === "number";
  const hasSatelliteSpots = typeof listing.lat === "number" && typeof listing.lng === "number"
    && Array.isArray(listing.spots) && listing.spots.some(s => s.forRent)
    && listing.spots.filter(s => s.forRent).every(hasValidBounds)
    && !!import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const rentableSpots = hasSatelliteSpots ? listing.spots.filter(s => s.forRent) : null;
  const availableCount = rentableSpots ? rentableSpots.length : Math.min(listing.spaces || 1, 4);
  const spotStates = Array.isArray(listing.spots) && listing.spots.length > 0
    ? Array.from({ length: 4 }, (_, i) => !!listing.spots[i]?.forRent)
    : undefined;
  const spotLabel = (i) => String.fromCharCode(65 + i); // A, B, C… works past the old 4-spot cap

  const numericIdForAvailability = String(listing.id).startsWith("db-") ? Number(String(listing.id).slice(3)) : null;

  // Glanceable "right now" badge shown near the title — always reflects this
  // instant, independent of whatever the renter has selected below.
  const [liveAvailability, setLiveAvailability] = useState(null); // null = not checked yet / demo listing
  useEffect(() => {
    if (numericIdForAvailability === null) return;
    let cancelled = false;
    fetch(`/api/listing-availability?listingId=${numericIdForAvailability}&hours=1`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data) setLiveAvailability(data); })
      .catch(() => {}); // best-effort — booking itself is still enforced server-side regardless
    return () => { cancelled = true; };
  }, [numericIdForAvailability]);

  // Live check tied to whatever the renter has actually selected — re-runs
  // whenever the mode, duration, date, or time changes. This is what catches
  // "someone else just took the last spot for that future slot" BEFORE
  // checkout, not just at the final payment step. Uses the same
  // getSessionWindow logic server-side as the actual booking enforcement, so
  // this can never show "available" for something that then gets rejected.
  const [selectedAvailability, setSelectedAvailability] = useState(null);
  useEffect(() => {
    if (numericIdForAvailability === null) return;
    let cancelled = false;
    setSelectedAvailability(null); // clear stale result immediately while the new one loads
    const params = new URLSearchParams({ listingId: String(numericIdForAvailability), hours: String(hours) });
    if (bookingMode === "advance") {
      params.set("bookingDate", date.toISOString());
      params.set("startHour", String(startHour));
    }
    fetch(`/api/listing-availability?${params.toString()}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data) setSelectedAvailability(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [numericIdForAvailability, bookingMode, hours, bookingMode === "advance" ? date.getTime() : null, bookingMode === "advance" ? startHour : null]);

  const confirmBooking = async () => {
    // Only reached for demo listings — real (host-listed) bookings are now
    // written by the Stripe webhook once payment actually succeeds, since
    // the browser navigates away to Stripe's checkout page for those.
    setBookingError("");
    setShowPayment(false);
    setBooked(true);
  };

  return (
    <div style={{ padding: 24, fontFamily: "'Poppins', sans-serif", maxWidth: 580, margin: "0 auto" }}>
      <button onClick={onBack} style={{ background: C.amber, border: "2px solid "+C.navy, boxShadow: "0 0 0 2px " + C.white, color: C.navy, fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 16, padding: "5px 13px", borderRadius: 8 }}>← Back to Listings</button>

      <div style={{ background: "linear-gradient(135deg, "+C.navy+", #33465A)", borderRadius: 14, height: 170, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 80, marginBottom: 20, overflow: "hidden" }}>
        <ListingThumb listing={listing} fontSize={80} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <h2 style={{ fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 20, margin: 0, flex: 1 }}>{listing.title}</h2>
        <PriceTag price={listing.price} size="lg" />
      </div>
      <p style={{ color: C.muted, fontSize: 12, marginBottom: 10 }}>📍 {listing.address} · {listing.distance}</p>

      {liveAvailability && (
        <div style={{ marginBottom: 10 }}>
          {liveAvailability.available ? (
            <Badge color={C.moss}>🟢 {liveAvailability.spacesFree} spot{liveAvailability.spacesFree === 1 ? "" : "s"} available now</Badge>
          ) : (
            <Badge color={C.amber}>🔴 Full right now — no spots free</Badge>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {listing.features.map(f => <Badge key={f}>{f}</Badge>)}
      </div>

 {typeof listing.lat === "number" && typeof listing.lng === "number" && (
        <SpotMapBoundary fallback={null}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>📍 Where you'll park</div>
            <ListingSatelliteView lat={listing.lat} lng={listing.lng} spots={(listing.spots || []).filter(hasValidBounds)} />
          </div>
        </SpotMapBoundary>
      )}

      {/* Host */}
      <div style={{ background: C.warmWhite, border: "1px solid "+C.concrete, borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{listing.hostImg}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.navy }}>{listing.host}</div>
            <div style={{ fontSize: 11, color: C.muted }}>Host · {listing.spaces} space{listing.spaces > 1 ? "s" : ""}</div>
          </div>
        </div>
        <Btn small variant="outline" onClick={() => onMessage(listing)}>💬 Message</Btn>
      </div>

      {/* Book panel */}
      {booked ? (
        <div style={{ background: C.mossLight, border: "1px solid "+C.moss, borderRadius: 12, padding: 18, marginBottom: 20, textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🎉</div>
          <div style={{ fontWeight: 700, color: C.moss, fontSize: 15, marginBottom: 4 }}>Booking confirmed!</div>
          <div style={{ fontSize: 13, color: C.moss, marginBottom: 12 }}>Check My Bookings for details.</div>
          <Btn small variant="amber" onClick={() => window.open(buildNavigationUrl(listing.address, listing.lat, listing.lng), "_blank", "noopener,noreferrer")}>🧭 Navigate there</Btn>
        </div>
      ) : (
        <div style={{ background: C.warmWhite, border: "1px solid "+C.concrete, borderRadius: 12, padding: 18, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, color: C.navy, marginBottom: 12 }}>Book this spot</div>

          {/* Mode toggle — two genuinely different flows, not one flow with
              a confusing default. Switching modes clears the stale
              availability result so nothing shown is ever for the wrong mode. */}
          <div style={{ display: "flex", background: C.concrete, borderRadius: 10, padding: 2, marginBottom: 16 }}>
            {[["now", "⚡ Book Now"], ["advance", "📅 Schedule for Later"]].map(([mode, label]) => (
              <button key={mode} onClick={() => setBookingMode(mode)} style={{
                flex: 1, padding: "9px 4px", borderRadius: 8, border: "none", cursor: "pointer",
                fontFamily: "'Poppins', sans-serif", fontSize: 11, fontWeight: 700,
                background: bookingMode === mode ? C.white : "transparent",
                color: bookingMode === mode ? C.navy : C.muted,
              }}>{label}</button>
            ))}
          </div>

          {bookingMode === "now" ? (
            <>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
                Starts the moment you pay · {new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} today
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>How long do you need?</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {NOW_DURATIONS.map(d => (
                  <button key={d} onClick={() => setNowDuration(d)} style={{
                    padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "'Poppins', sans-serif",
                    fontSize: 12, fontWeight: 700,
                    background: nowDuration === d ? C.amber : C.white,
                    border: nowDuration === d ? "2px solid " + C.navy : "1px solid " + C.concrete,
                    color: C.navy,
                  }}>{d === 0.5 ? "30 min" : d + " hr"}</button>
                ))}
                <button onClick={() => setNowDuration("custom")} style={{
                  padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "'Poppins', sans-serif",
                  fontSize: 12, fontWeight: 700,
                  background: isCustomDuration ? C.amber : C.white,
                  border: isCustomDuration ? "2px solid " + C.navy : "1px solid " + C.concrete,
                  color: C.navy,
                }}>Custom</button>
              </div>
              {isCustomDuration && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <input type="number" min="0.25" step="0.25" value={nowCustomHours} onChange={e => setNowCustomHours(e.target.value)}
                    style={{ width: 70, border: "1px solid "+C.concrete, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: C.navy, fontFamily: "'Poppins', sans-serif" }} />
                  <span style={{ fontSize: 12, color: C.muted }}>hours</span>
                </div>
              )}
              <div style={{ fontSize: 12, color: C.navy, fontWeight: 700, marginBottom: 4 }}>
                Ends around {new Date(Date.now() + hours * 3600 * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} today
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: C.muted }}>Date</div>
                  <button onClick={() => setShowCalendar(true)} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>Change</button>
                </div>
                <button onClick={() => setShowCalendar(true)} style={{ width: "100%", textAlign: "left", background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 8, padding: "10px 14px", fontFamily: "'Poppins', sans-serif", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>📅</span>
                  <span style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>{date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
                </button>
              </div>
              <div style={{ marginBottom: 8, paddingTop: 14, borderTop: "1px solid "+C.concrete }}>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>Time needed</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <select value={startHour} onChange={handleStartChange} style={{ flex: 1, border: "1px solid "+C.concrete, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: C.navy, fontFamily: "'Poppins', sans-serif", background: C.white }}>
                    {HOUR_OPTIONS.map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
                  </select>
                  <span style={{ color: C.muted, fontSize: 13 }}>to</span>
                  <select value={endHour} onChange={handleEndChange} style={{ flex: 1, border: "1px solid "+C.concrete, borderRadius: 8, padding: "8px 10px", fontSize: 13, color: C.navy, fontFamily: "'Poppins', sans-serif", background: C.white }}>
                    {HOUR_OPTIONS.filter(h => h > startHour).map(h => <option key={h} value={h}>{formatHour(h)}</option>)}
                  </select>
                </div>
                <div style={{ fontSize: 11, color: C.moss, fontWeight: 700, marginTop: 6 }}>{hours} hour{hours > 1 ? "s" : ""} total</div>
              </div>
            </>
          )}

          {/* Live check tied to exactly what's selected above — re-runs on
              every duration/date/time change, so this never lags behind
              what's actually being booked. */}
          {numericIdForAvailability !== null && (
            selectedAvailability === null ? (
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 8 }}>Checking availability…</div>
            ) : selectedAvailability.available ? (
              <div style={{ display: "flex", alignItems: "center", gap: 5, background: C.mossLight, border: "1px solid "+C.moss, borderRadius: 6, padding: "5px 8px", marginBottom: 8 }}>
                <span style={{ fontSize: 10 }}>🟢</span>
                <span style={{ fontSize: 10, color: C.moss, fontWeight: 700 }}>
                  {selectedAvailability.spacesFree} of {selectedAvailability.spacesTotal} free for that {bookingMode === "now" ? "time" : "slot"} — confirmed again at checkout
                </span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 5, background: C.amberLight, border: "1px solid "+C.amber, borderRadius: 6, padding: "5px 8px", marginBottom: 8 }}>
                <span style={{ fontSize: 10 }}>🔴</span>
                <span style={{ fontSize: 10, color: C.navy, fontWeight: 700 }}>
                  Full for that {bookingMode === "now" ? "time" : "slot"} — try a different {bookingMode === "now" ? "duration" : "time"}
                </span>
              </div>
            )
          )}

          <div style={{ marginBottom: 14, paddingTop: 14, borderTop: "1px solid "+C.concrete }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 12, color: C.muted }}>Parking spot</div>
              <button onClick={() => setShowSpotPicker(true)} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, fontSize: 12, textDecoration: "underline", cursor: "pointer" }}>{chosenSpot === null ? "Choose spot" : "Change"}</button>
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, color: chosenSpot === null ? C.muted : C.navy, marginTop: 2 }}>
              {chosenSpot === null ? "Not selected yet" : "Spot " + spotLabel(chosenSpot)}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 14, borderTop: "1px solid "+C.concrete }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted }}>Total (incl. fees)</div>
              <div style={{ fontWeight: 800, fontSize: 24, color: C.amber }}>${Math.round(listing.price * hours * 1.15)}</div>
            </div>
            <Btn variant="amber" onClick={() => setShowPayment(true)} disabled={chosenSpot === null || selectedAvailability?.available === false}>Reserve & pay →</Btn>
          </div>
        </div>
      )}
{showCalendar && (
        <Modal title="Choose a date" onClose={() => setShowCalendar(false)}>
          <MiniCalendar selected={date} onSelect={(d) => { setDate(d); setShowCalendar(false); }} />
        </Modal>
      )}
      {showSpotPicker && (
        <Modal title={"Choose your spot — " + listing.title} onClose={() => setShowSpotPicker(false)}>
          <div style={{ borderRadius: 12, overflow: "hidden", marginBottom: 14, height: 140, background: C.concrete }}>
            <ListingThumb listing={listing} size="100%" />
          </div>
          <p style={{ fontSize: 12, color: C.muted, marginTop: -6, marginBottom: 14 }}>
            {selectedAvailability
              ? (selectedAvailability.available
                  ? `${selectedAvailability.spacesFree} of ${selectedAvailability.spacesTotal} spot${selectedAvailability.spacesTotal === 1 ? "" : "s"} free for ${bookingMode === "now" ? "right now" : "that time"}. Tap the one you'd like to park in.`
                  : `All spots are taken for ${bookingMode === "now" ? "right now" : "that time"} — try a different ${bookingMode === "now" ? "duration" : "time"}, or pick a different listing.`)
              : `This driveway has ${availableCount} spot${availableCount !== 1 ? "s" : ""} available for rent. Tap the one you'd like to park in.`}
          </p>
          {hasSatelliteSpots ? (
                <SpotMapBoundary fallback={<SpotPicker availableCount={availableCount} chosen={chosenSpot} onChoose={setChosenSpot} spotStates={spotStates} spotStatus={selectedAvailability?.spotStatus} />}>
                  <div style={{ marginBottom: 16 }}>
                    <ListingSatelliteView lat={listing.lat} lng={listing.lng} spots={listing.spots} interactive chosen={chosenSpot} onChoose={setChosenSpot} height={260} />
                  </div>
                </SpotMapBoundary>
              ) : (
                <SpotPicker availableCount={availableCount} chosen={chosenSpot} onChoose={setChosenSpot} spotStates={spotStates} spotStatus={selectedAvailability?.spotStatus} />
              )}
          <Btn variant="amber" full onClick={() => setShowSpotPicker(false)} disabled={chosenSpot === null} >{chosenSpot === null ? "Pick a spot to continue" : "Confirm Spot " + spotLabel(chosenSpot)}</Btn>
        </Modal>
      )}

      <ReviewsSection listing={listing} user={user} />

      {showPayment && (
      <PaymentModal
          listing={listing}
          hours={hours}
          chosenSpot={chosenSpot}
          date={bookingMode === "advance" ? date : undefined}
          startHour={bookingMode === "advance" ? startHour : undefined}
          endHour={bookingMode === "advance" ? endHour : undefined}
          onClose={() => setShowPayment(false)}
          onSuccess={confirmBooking}
          user={user}
        />
      )}
      {bookingError && <p style={{ color: C.red, fontSize: 12, textAlign: "center" }}>{bookingError}</p>}
    </div>
  );
}

// Fetches host-created listings from Supabase and merges them with the
// built-in demo listings, so new "List Your Driveway" submissions show up
// in Browse immediately alongside the sample data.
function useAllListings() {
  const [dbListings, setDbListings] = useState([]);

  const refresh = () => {
    supabase
      .from("listings")
      .select("*, profiles(name)")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error || !data) return;
        setDbListings(
          data.map(row => ({
            id: "db-" + row.id,
            title: row.title,
            address: row.address,
            price: Number(row.price),
            rating: 5,
            reviewCount: 0,
            spaces: row.spaces,
            features: row.features || [],
            img: row.img || "🏠",
            photos: row.photos || [],
            distance: "—",
            lat: row.lat,
            lng: row.lng,
            spots: row.spots || [],
            host: row.profiles?.name || "Host",
            hostImg: "🧑",
          }))
        );
      });
  };

  useEffect(() => { refresh(); }, []);

  return dbListings;
}

// ─── Browse View ──────────────────────────────────────────────────────────────
function BrowseView({ onMessage, user, autoFocusSearch, autoLocate, initialLocation, initialQuery }) {
  const allListings = useAllListings();
  const [query, setQuery] = useState("");
  const [locatedSearch, setLocatedSearch] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSug, setLoadingSug] = useState(false);
  const [sugError, setSugError] = useState(false);
  const [sort, setSort] = useState("distance");
  const [selected, setSelected] = useState(null);
  const [mapHovered, setMapHovered] = useState(null);
  const [view, setView] = useState("map");
  const [userLoc, setUserLoc] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const debounceRef = useRef(null);
  const searchInputRef = useRef(null);

  // If the live geocoder can't be reached, fall back to matching against our
  // own listing addresses so the dropdown still shows something useful.
  const localFallbackSuggestions = (val) => {
    const q = val.toLowerCase();
    return allListings
      .filter(l => l.address.toLowerCase().includes(q) || l.title.toLowerCase().includes(q))
      .slice(0, 5)
      .map(l => ({ short: l.address, full: l.title + " — " + l.address, lat: l.lat, lng: l.lng }));
  };

  const handleSearch = (val) => {
    setQuery(val);
    setLocatedSearch(false);
    setSuggestions([]);
    setSugError(false);
    clearTimeout(debounceRef.current);
    if (val.length < 2) { setLoadingSug(false); return; }
    setLoadingSug(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=" + encodeURIComponent(val), { headers: { "Accept-Language": "en" } });
        if (!res.ok) throw new Error("Geocoder returned " + res.status);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Unexpected response shape");
        const results = data.map(d => ({
          short: [d.address.house_number, d.address.road, d.address.city || d.address.town || d.address.suburb, d.address.state].filter(Boolean).join(", "),
          full: d.display_name,
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
        }));
        if (results.length === 0) {
          // No matches from the geocoder — still offer local listing matches if any.
          const local = localFallbackSuggestions(val);
          setSuggestions(local);
        } else {
          setSuggestions(results);
        }
      } catch (e) {
        // Network/CORS/geocoder failure — fall back to matching local listings
        // so the search bar isn't a dead end, and flag that live lookup failed.
        setSugError(true);
        setSuggestions(localFallbackSuggestions(val));
      }
      setLoadingSug(false);
    }, 350);
  };

  const pickSuggestion = (s) => {
    setQuery(s.short);
    setSuggestions([]);
    if (!isNaN(s.lat) && !isNaN(s.lng)) {
      setUserLoc({ lat: s.lat, lng: s.lng });
      setSort("distance");
      setLocatedSearch(true);
    }
  };

  const getLocation = () => {
    if (userLoc) { setUserLoc(null); setLocatedSearch(false); return; }
    if (!navigator.geolocation) { setLocationError("Location isn't available on this device."); return; }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      p => { setUserLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocating(false); setSort("distance"); setLocatedSearch(false); setQuery(""); },
      () => { setLocating(false); setLocationError("Couldn't get your location — check your browser/location permissions."); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Arriving from the landing page: honor whichever action the person picked there.
  useEffect(() => {
    if (initialLocation) {
      // They picked a specific address from the landing page's autocomplete —
      // apply it exactly like picking a suggestion here would.
      setUserLoc(initialLocation);
      setSort("distance");
      setLocatedSearch(true);
      if (initialQuery) setQuery(initialQuery);
    } else if (autoLocate) {
      getLocation();
    } else if (initialQuery) {
      // They typed something on the landing page but didn't pick a suggestion —
      // carry the text over and let normal listing-text filtering apply.
      setQuery(initialQuery);
    } else if (autoFocusSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = allListings
    .filter(l => locatedSearch || !query || l.address.toLowerCase().includes(query.toLowerCase()) || l.title.toLowerCase().includes(query.toLowerCase()))
    .map(l => ({ ...l, distMiles: userLoc ? milesBetween(userLoc.lat, userLoc.lng, l.lat, l.lng) : parseFloat(l.distance) }))
    .sort((a, b) => sort === "price" ? a.price - b.price : sort === "rating" ? b.rating - a.rating : a.distMiles - b.distMiles);

  if (selected) return <ListingDetail listing={selected} onBack={() => setSelected(null)} onMessage={onMessage} user={user} />;

  return (
    <div style={{ fontFamily: "'Poppins', sans-serif", display: "flex", flexDirection: "column", height: "calc(100vh - 88px)" }}>

      {/* Toolbar */}
      <div style={{ background: C.white, borderBottom: "1px solid "+C.concrete, padding: "8px 12px", flexShrink: 0 }}>
        {/* Row 1: location + search */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input ref={searchInputRef} value={query} onChange={e => handleSearch(e.target.value)} placeholder="Search address or driveway…"
              style={{ width: "100%", border: "1.5px solid "+C.concrete, borderRadius: 20, padding: "6px 12px", fontSize: 12, outline: "none", color: C.navy, background: C.warmWhite, boxSizing: "border-box" }} />
            {loadingSug && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 11 }}>⏳</span>}
            {/* Autocomplete dropdown */}
            {suggestions.length === 0 && sugError && !loadingSug && query.length >= 2 && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: C.white, border: "1.5px solid "+C.concrete, borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", zIndex: 500, padding: "9px 12px", fontSize: 11, color: C.muted }}>
                Couldn't reach the address lookup service, and no nearby listings matched "{query}".
              </div>
            )}
            {suggestions.length > 0 && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: C.white, border: "1.5px solid "+C.concrete, borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", zIndex: 500, overflow: "hidden" }}>
                {sugError && (
                  <div style={{ padding: "6px 12px", fontSize: 10, color: C.muted, background: C.warmWhite, borderBottom: "1px solid "+C.concrete }}>
                    Live address lookup unavailable — showing matches from nearby listings
                  </div>
                )}
                {suggestions.map((s, i) => (
                  <div key={i} onClick={() => pickSuggestion(s)}
              style={{ padding: "9px 12px", borderBottom: i < suggestions.length - 1 ? "1px solid "+C.concrete : "none", cursor: "pointer", display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ flexShrink: 0, marginTop: 1 }}>📍</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: C.navy, whiteSpace: "normal", wordBreak: "break-word" }}>{s.short}</div>
                  <div style={{ fontSize: 10, color: C.muted, whiteSpace: "normal", wordBreak: "break-word" }}>{s.full}</div>
                </div>
              </div>
                ))}
              </div>
            )}
          </div>
          <select value={sort} onChange={e => setSort(e.target.value)}
            style={{ flexShrink: 0, border: "1.5px solid "+C.concrete, borderRadius: 20, padding: "6px 8px", fontSize: 11, color: C.navy, cursor: "pointer", background: C.warmWhite }}>
            <option value="distance">Nearest</option>
            <option value="price">Price</option>
            <option value="rating">Rating</option>
          </select>
        </div>
        {locationError && (
          <div style={{ fontSize: 11, color: C.red, marginBottom: 6 }}>⚠️ {locationError}</div>
        )}
        {/* Row 2: location button (left) and view toggles, positioned under the sort dropdown (right) */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={getLocation} title={userLoc ? "Clear location" : "Use my location"} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, background: userLoc ? C.moss : C.concrete, color: userLoc ? C.white : C.muted, border: "none", borderRadius: 20, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            <span>{locating ? "⏳" : "📍"}</span>
            <span>{locating ? "Locating…" : userLoc ? "Located" : "My location"}</span>
          </button>
          <div style={{ display: "flex", flexShrink: 0 }}>
            {[["split","⊞"],["list","☰"],["map","🗺"]].map(([v,label]) => (
              <button key={v} onClick={() => setView(v)} style={{ background: view === v ? C.navy : "transparent", color: view === v ? C.white : C.muted, border: "none", borderRadius: 18, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

        {/* Content — fills all remaining height, no scroll */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Listing column */}
        {view !== "map" && (
          <div style={{ width: view === "split" ? "42%" : "100%", overflowY: "auto", flexShrink: 0, borderRight: view === "split" ? "1px solid "+C.concrete : "none" }}>
            {filtered.map(l => (
              <div key={l.id} onClick={() => setSelected(l)} onMouseEnter={() => setMapHovered(l)} onMouseLeave={() => setMapHovered(null)}
                style={{
                  margin: "8px 10px", borderRadius: 20, cursor: "pointer",
                  background: C.amber, border: "3px solid " + C.white,
                  boxShadow: mapHovered?.id === l.id ? "0 4px 16px rgba(28,43,57,0.28)" : "0 2px 7px rgba(28,43,57,0.14)",
                  outline: mapHovered?.id === l.id ? "2px solid " + C.navy : "none",
                  padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8,
                  transition: "box-shadow 0.15s",
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ListingThumb listing={l} fontSize={24} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.title}</div>
                    <div style={{ fontSize: 10, color: C.navy, opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.address}</div>
                  </div>
                  <PriceTag price={l.price} size="sm" />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.navy, fontWeight: 700 }}>
                  <span>★ {l.rating} <span style={{ fontWeight: 500, opacity: 0.7 }}>({l.reviewCount})</span></span>
                  <span style={{ fontWeight: 500, opacity: 0.8 }}>{l.distMiles.toFixed(1)} mi</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Map column */}
        {view !== "list" && (
          <div style={{ flex: 1, padding: 6 }}>
            <div style={{ height: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid "+C.concrete }}>
              <ListingsMap listings={filtered} selected={mapHovered} onSelect={l => { setMapHovered(l); setSelected(l); }} userLoc={userLoc} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Host Dashboard ───────────────────────────────────────────────────────────
const LISTING_FEATURE_OPTIONS = ["Covered", "CCTV", "Well-lit", "Gated", "24hr Access"];

function EditListingModal({ listing, onClose, onSave }) {
  const [price, setPrice] = useState(String(listing.price));
  const [description, setDescription] = useState(listing.description || "");
  const [features, setFeatures] = useState(listing.features || []);
  // Unify both data shapes into one editable total-count + per-tile-toggle model,
  // regardless of whether this listing originally had real drawn spots (with geo
  // bounds) or just a simple total-spaces number.
  const initialTotal = listing.spots?.length || listing.spaces || 1;
  const initialSelected = listing.spots?.length
    ? listing.spots.map(s => s.forRent)
    : Array.from({ length: initialTotal }, () => true);
  const [totalSpots, setTotalSpots] = useState(initialTotal);
  const [selectedSpots, setSelectedSpots] = useState(initialSelected);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const toggleSpotAt = (i) => setSelectedSpots(prev => prev.map((v, idx) => idx === i ? !v : v));
  const changeTotal = (n) => {
    const clamped = Math.max(1, Math.min(8, n));
    setTotalSpots(clamped);
    setSelectedSpots(prev => {
      const next = prev.slice(0, clamped);
      while (next.length < clamped) next.push(true); // new spots default to for-rent
      return next;
    });
  };
  const toggleFeature = (f) => setFeatures(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);

  const save = async () => {
    setErr("");
    const rentableCount = selectedSpots.filter(Boolean).length;
    if (rentableCount < 1) { setErr("At least one spot needs to be marked for rent."); return; }
    setSaving(true);
    // Preserve real geo bounds for spots that existed before (needed for the
    // satellite map view); new spots added here only exist in the simple
    // template view, since we have no real-world coordinates for them.
    const existingSpots = listing.spots || [];
    const newSpots = Array.from({ length: totalSpots }, (_, i) => ({
      id: existingSpots[i]?.id ?? "new-" + i + "-" + Date.now(),
      bounds: existingSpots[i]?.bounds ?? null,
      forRent: selectedSpots[i],
    }));
    const ok = await onSave({
      ...listing,
      price,
      description,
      features,
      spots: newSpots,
      spaces: rentableCount,
    });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal title={"Edit — " + listing.title} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={{ fontSize: 12, color: C.muted, fontWeight: 600, display: "block", marginBottom: 5 }}>Price per hour ($)</label>
          <input type="number" min="1" value={price} onChange={e => setPrice(e.target.value)}
            style={{ width: "100%", border: "1.5px solid " + C.concrete, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: C.navy, outline: "none", boxSizing: "border-box", fontFamily: "'Poppins', sans-serif" }} />
        </div>

        <div>
          <label style={{ fontSize: 12, color: C.muted, fontWeight: 600, display: "block", marginBottom: 5 }}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Anything useful for drivers to know…"
            style={{ width: "100%", border: "1.5px solid " + C.concrete, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: C.navy, outline: "none", boxSizing: "border-box", fontFamily: "'Poppins', sans-serif", resize: "vertical", minHeight: 70 }} />
        </div>

        <div>
          <label style={{ fontSize: 12, color: C.muted, fontWeight: 600, display: "block", marginBottom: 8 }}>Features</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {LISTING_FEATURE_OPTIONS.map(f => {
              const on = features.includes(f);
              return (
                <button key={f} onClick={() => toggleFeature(f)} style={{
                  background: on ? C.moss : C.warmWhite, color: on ? C.white : C.navy,
                  border: "1.5px solid " + (on ? C.moss : C.concrete), borderRadius: 20, padding: "6px 14px",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}>{on ? "✓ " : ""}{f}</button>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <label style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>How many spots does your driveway have?</label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => changeTotal(totalSpots - 1)} style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid " + C.concrete, background: C.white, cursor: "pointer", fontWeight: 700, color: C.navy }}>–</button>
              <span style={{ fontWeight: 800, color: C.navy, fontSize: 14, minWidth: 14, textAlign: "center" }}>{totalSpots}</span>
              <button onClick={() => changeTotal(totalSpots + 1)} style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid " + C.concrete, background: C.white, cursor: "pointer", fontWeight: 700, color: C.navy }}>+</button>
            </div>
          </div>
          <p style={{ fontSize: 11, color: C.muted, margin: "0 0 8px" }}>Tap a spot below to mark it for rent or keep it private.</p>
          <DrivewaySpotMap total={totalSpots} selected={selectedSpots} onToggle={toggleSpotAt} />
          <div style={{ fontSize: 12, color: C.navy, fontWeight: 700, textAlign: "center", marginTop: 8 }}>
            {selectedSpots.filter(Boolean).length} of {totalSpots} marked for rent
          </div>
        </div>

        {err && <div style={{ background: C.redLight, color: C.red, fontSize: 12, fontWeight: 600, padding: "8px 12px", borderRadius: 8 }}>{err}</div>}

        <Btn variant="amber" full onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Btn>
      </div>
    </Modal>
  );
}

// ─── Transactions (shared by HostDashboard's earnings card + the full
// Transactions tab) ─────────────────────────────────────────────────────────
// Single hook, single fetch pattern — same auth approach as
// ExtendSessionModal's payWithStripe() call (current Supabase JWT, refresh
// if needed). Each caller does its own fetch rather than sharing state
// across components; fine at this scale, worth revisiting with a shared
// cache/context if this page gets hit often enough to matter.
function useTransactions(user) {
  const [data, setData] = useState({ spent: [], earned: [], payouts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      try {
        let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        let session = sessionData?.session;
        if (sessionError || !session?.access_token) {
          const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
          if (refreshError) throw refreshError;
          session = refreshedData?.session;
        }
        if (!session?.access_token) throw new Error("Your session is invalid or expired. Please sign in again.");

        const res = await fetch("/api/transactions", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Couldn't load transactions.");
        if (!cancelled) setData({ spent: json.spent || [], earned: json.earned || [], payouts: json.payouts || [] });
      } catch (err) {
        if (!cancelled) setError(err.message || "Something went wrong.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  return { data, loading, error };
}

// Maps the real statuses your backend actually uses (bookings.status /
// booking_extensions.status / Stripe payout status) to a label + color —
// replaces the old MyBookingsView pattern of collapsing everything that
// isn't "confirmed" or "completed" into a generic "Cancelled".
function transactionStatusLabel(status) {
  switch (status) {
    case "confirmed": return { label: "Paid", color: C.moss };
    case "completed": return { label: "Completed", color: C.moss };
    case "payment_failed": return { label: "Failed", color: C.red };
    case "refunded": return { label: "Refunded", color: C.muted };
    case "partially_refunded": return { label: "Partially refunded", color: C.amber };
    case "disputed": return { label: "Disputed", color: C.red };
    case "paid": return { label: "Paid out", color: C.moss };
    case "pending": return { label: "Pending", color: C.amber };
    case "in_transit": return { label: "In transit", color: C.amber };
    case "failed": return { label: "Failed", color: C.red };
    case "canceled": return { label: "Canceled", color: C.muted };
    default: return { label: status || "Unknown", color: C.muted };
  }
}

function money(n) {
  return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Transactions tab — full history for both what you've spent and, if
// you host any listings, what you've earned and been paid out. ────────────
function TransactionsView({ user }) {
  const { data, loading, error } = useTransactions(user);
  const [section, setSection] = useState("spent"); // "spent" | "earned" | "payouts"

  const hasEarnings = data.earned.length > 0 || data.payouts.length > 0;
  const sections = hasEarnings ? ["spent", "earned", "payouts"] : ["spent"];
  const sectionLabels = { spent: "What you've paid", earned: "What you've earned", payouts: "Payouts" };

  const rows = section === "spent" ? data.spent : section === "earned" ? data.earned : [];

  return (
    <div style={{ padding: "24px 20px", fontFamily: "'Poppins', sans-serif", maxWidth: 640, margin: "0 auto" }}>
      <h2 style={{ fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 22, marginBottom: 20 }}>Transactions</h2>

      {sections.length > 1 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {sections.map(s => (
            <button key={s} onClick={() => setSection(s)} style={{
              flex: 1, padding: "9px 10px", borderRadius: 8, cursor: "pointer",
              border: section === s ? "2px solid " + C.amber : "1.5px solid " + C.concrete,
              background: section === s ? C.amberLight : C.white,
              fontWeight: 700, fontSize: 12, color: C.navy,
            }}>
              {sectionLabels[s]}
            </button>
          ))}
        </div>
      )}

      {loading && <p style={{ fontSize: 13, color: C.muted }}>Loading…</p>}
      {error && <p style={{ fontSize: 13, color: C.red }}>{error}</p>}

      {!loading && !error && section !== "payouts" && rows.length === 0 && (
        <p style={{ fontSize: 13, color: C.muted }}>Nothing here yet.</p>
      )}

      {!loading && !error && section !== "payouts" && rows.map(t => {
        const st = transactionStatusLabel(t.status);
        const amount = section === "earned" ? t.net : t.amount;
        return (
          <div key={t.id} style={{ background: C.white, border: "1px solid " + C.concrete, borderRadius: 12, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>{t.description}</div>
                {t.address && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>📍 {t.address}</div>}
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}{t.spotLabel ? ` · Spot ${t.spotLabel}` : ""}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <Badge color={st.color}>{st.label}</Badge>
                <div style={{ fontWeight: 800, fontSize: 16, color: C.navy, marginTop: 6 }}>{money(amount)}</div>
              </div>
            </div>
            {section === "earned" && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 8, paddingTop: 8, borderTop: "1px solid " + C.concrete }}>
                {money(t.gross)} charged − {money(t.platformFee)} platform fee = {money(t.net)} to you
                {t.approximateFeeSplit ? " (fee estimated)" : ""}
              </div>
            )}
          </div>
        );
      })}

      {!loading && !error && section === "payouts" && data.payouts.length === 0 && (
        <p style={{ fontSize: 13, color: C.muted }}>No payouts yet.</p>
      )}
      {!loading && !error && section === "payouts" && data.payouts.map(p => {
        const st = transactionStatusLabel(p.status);
        return (
          <div key={p.id} style={{ background: C.white, border: "1px solid " + C.concrete, borderRadius: 12, padding: "14px 16px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>Payout</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Arrives {new Date(p.arrivalDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <Badge color={st.color}>{st.label}</Badge>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.navy, marginTop: 6 }}>{money(p.amount)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HostDashboard({ user, setTab }) {
  const [dbListings, setDbListings] = useState([]);
  const [dbBookings, setDbBookings] = useState([]);

  // ─── Stripe Connect payout status ────────────────────────────────────────
  // Reads straight from `profiles` so it always reflects the latest state
  // written by the account.updated webhook, including right after a host
  // returns from Stripe's hosted onboarding flow.
  const [stripeStatus, setStripeStatus] = useState({ loading: true, accountId: null, chargesEnabled: false, payoutsEnabled: false });
  const [connectError, setConnectError] = useState("");
  const [connecting, setConnecting] = useState(false);

  const refreshStripeStatus = () => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setStripeStatus(s => ({ ...s, loading: false })); return; }
        setStripeStatus({
          loading: false,
          accountId: data.stripe_account_id || null,
          chargesEnabled: !!data.stripe_charges_enabled,
          payoutsEnabled: !!data.stripe_payouts_enabled,
        });
      });
  };

  useEffect(() => { refreshStripeStatus(); }, [user]);

  const connectStripe = async () => {
    if (!user) return;
    setConnectError("");
    setConnecting(true);

    try {
      // Stripe onboarding is protected by the same Supabase JWT used for
      // checkout. Refresh once if the locally stored session is stale.
      let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      let session = sessionData?.session;

      if (sessionError || !session?.access_token) {
        const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        session = refreshedData?.session;
      }

      if (!session?.access_token) {
        throw new Error("Your session is invalid or expired. Please sign in again.");
      }

      const res = await fetch("/api/connect-onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // Use the fallback message below when the API returns no JSON body.
      }

      if (res.status === 401) {
        throw new Error("Your session is invalid or expired. Please sign in again.");
      }
      if (!res.ok) throw new Error(data.error || "Couldn't start Stripe onboarding.");
      if (!data.url) throw new Error("Stripe did not return an onboarding link.");

      window.location.assign(data.url);
    } catch (err) {
      setConnecting(false);
      setConnectError(err?.message || "Couldn't start Stripe onboarding.");
    }
  };

  useEffect(() => {
    if (!user) return;

    supabase
      .from("listings")
      .select("*")
      .eq("host_id", user.id)
      .then(({ data, error }) => {
        if (error || !data) return;
        setDbListings(
          data.map(row => ({
            id: "db-" + row.id,
            rawId: row.id,
            title: row.title,
            address: row.address,
            price: Number(row.price),
            active: true,
            earnings: 0,
            bookings: 0,
            rating: 5,
            img: row.img || "🏠",
            description: row.description || "",
            features: row.features || [],
            spaces: row.spaces || 1,
            spots: row.spots || [],
          }))
        );

        const listingIds = data.map(row => row.id);
        if (listingIds.length === 0) return;
        supabase
          .from("bookings")
          .select("*, listings(title), profiles(name)")
          .in("listing_id", listingIds)
          .order("created_at", { ascending: false })
          .then(({ data: bookingRows, error: bookingErr }) => {
            if (bookingErr || !bookingRows) return;
            setDbBookings(
              bookingRows.map(row => ({
                id: "db-" + row.id,
                listing: row.listings?.title || "Listing",
                driver: row.profiles?.name || "Renter",
                time: new Date(row.created_at).toLocaleDateString() + " · " + row.hours + " hr" + (row.hours === 1 ? "" : "s"),
                total: row.total,
                status: row.status === "confirmed" ? "Confirmed" : row.status === "completed" ? "Completed" : "Cancelled",
              }))
            );
          });
      });
  }, [user]);

  const myListings = dbListings;
  const upcomingBookings = dbBookings;
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [editingListing, setEditingListing] = useState(null);

  const deleteListing = async (rawId, displayId) => {
    setDeletingId(displayId);
    const { error } = await supabase.from("listings").delete().eq("id", rawId);
    setDeletingId(null);
    setConfirmDeleteId(null);
    if (error) { alert("Couldn't delete listing: " + error.message); return; }
    setDbListings(prev => prev.filter(l => l.id !== displayId));
  };

  const saveListingEdit = async (updated) => {
    const { error } = await supabase.from("listings").update({
      price: Number(updated.price) || 1,
      description: updated.description,
      features: updated.features,
      spots: updated.spots,
      spaces: updated.spaces,
    }).eq("id", updated.rawId);
    if (error) { alert("Couldn't save changes: " + error.message); return false; }
    setDbListings(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l));
    return true;
  };
  const totalEarnings = myListings.reduce((s, l) => s + l.earnings, 0);
  const { data: txData, loading: txLoading } = useTransactions(user);

  const now = new Date();
  const sameMonth = (d, monthsAgo) => {
    const dt = new Date(d);
    const target = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    return dt.getFullYear() === target.getFullYear() && dt.getMonth() === target.getMonth();
  };
  const paidEarned = txData.earned.filter(t => t.status === "confirmed" || t.status === "completed");
  const thisMonthEarned = paidEarned.filter(t => sameMonth(t.date, 0)).reduce((s, t) => s + t.net, 0);
  const lastMonthEarned = paidEarned.filter(t => sameMonth(t.date, 1)).reduce((s, t) => s + t.net, 0);
  const allTimeEarned = paidEarned.reduce((s, t) => s + t.net, 0);
  const nextPayout = txData.payouts.find(p => p.status === "pending" || p.status === "in_transit");
  const totalBookings = myListings.reduce((s, l) => s + l.bookings, 0);
  const avgRating = myListings.length ? (myListings.reduce((s, l) => s + l.rating, 0) / myListings.length).toFixed(1) : "—";

  return (
    <div style={{ fontFamily: "'Poppins', sans-serif", background: C.warmWhite, height: "calc(100vh - 88px)", overflow: "hidden", display: "flex", flexDirection: "column" }}>

      {/* Welcome banner */}
      <div style={{ background: "linear-gradient(135deg, "+C.navy+", #33465A)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: "'Poppins', sans-serif", color: C.white, fontSize: 16, fontWeight: 700 }}>Welcome back, {user?.name || "Host"} 👋</div>
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, marginTop: 2 }}>Host since Jan 2025</div>
        </div>
        <div style={{ background: C.amber, borderRadius: 10, padding: "6px 12px", textAlign: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.navy }}>${totalEarnings}</div>
          <div style={{ fontSize: 9, color: C.navy, fontWeight: 600, textTransform: "uppercase" }}>Earned</div>
        </div>
      </div>

      {/* Main grid — everything fits on screen */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "auto 1fr 1fr", gap: 8, padding: 10, overflow: "hidden" }}>

        {/* Stats row — spans full width */}
        <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {[
            { label: "Bookings", value: String(totalBookings), icon: "📅" },
            { label: "Avg Rating", value: "★ "+avgRating, icon: "⭐" },
            { label: "Pending", value: "$140", icon: "💳" },
          ].map(s => (
            <div key={s.label} style={{ background: C.white, border: "1px solid "+C.concrete, borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
              <div style={{ fontSize: 16, marginBottom: 2 }}>{s.icon}</div>
              <div style={{ fontWeight: 800, fontSize: 16, color: C.navy }}>{s.value}</div>
              <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Upcoming Bookings */}
        <div style={{ background: C.white, border: "1px solid "+C.concrete, borderRadius: 10, padding: "10px 10px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.navy, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid "+C.amber }}>📅 Upcoming</div>
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: 5 }}>
            {upcomingBookings.map(b => (
              <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid "+C.concrete }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 11, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.driver}</div>
                  <div style={{ fontSize: 9, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.listing} · {b.time}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 6 }}>
                  <div style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: b.status === "Confirmed" ? C.mossLight : C.amberLight, color: b.status === "Confirmed" ? C.moss : C.navy }}>{b.status}</div>
                  <div style={{ fontWeight: 800, color: C.amber, fontSize: 11, marginTop: 2 }}>${b.total}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* My Listings */}
        <div style={{ background: C.white, border: "1px solid "+C.concrete, borderRadius: 10, padding: "10px 10px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.navy, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid "+C.amber, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>🏠 Listings</span>
            <button style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 8, padding: "2px 8px", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>+ Add</button>
          </div>
          <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
            {myListings.length === 0 && (
              <div style={{ fontSize: 11, color: C.muted, textAlign: "center", padding: "12px 0" }}>No listings yet.</div>
            )}
            {myListings.map(l => (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 0", borderBottom: "1px solid "+C.concrete }}>
                <div style={{ width: 22, height: 22, borderRadius: 5, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ListingThumb listing={l} fontSize={18} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 11, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.title}</div>
                  <div style={{ fontSize: 9, color: C.muted }}>${l.price}/hr · ★{l.rating} · {l.bookings} bookings</div>
                </div>
                <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: l.active ? C.mossLight : C.concrete, color: l.active ? C.moss : C.muted, flexShrink: 0 }}>{l.active ? "Active" : "Paused"}</span>
                {confirmDeleteId === l.id ? (
                  <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                    <button onClick={() => deleteListing(l.rawId, l.id)} disabled={deletingId === l.id} style={{ background: C.red, color: C.white, border: "none", borderRadius: 6, padding: "3px 6px", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>{deletingId === l.id ? "…" : "Confirm"}</button>
                    <button onClick={() => setConfirmDeleteId(null)} style={{ background: C.concrete, color: C.navy, border: "none", borderRadius: 6, padding: "3px 6px", fontSize: 9, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <button onClick={() => setEditingListing(l)} title="Edit listing" style={{ background: "none", border: "none", color: C.muted, fontSize: 13, cursor: "pointer", padding: "2px 4px" }}>✏️</button>
                    <button onClick={() => setConfirmDeleteId(l.id)} title="Delete listing" style={{ background: "none", border: "none", color: C.muted, fontSize: 13, cursor: "pointer", padding: "2px 4px" }}>🗑️</button>
                  </div>
                )}
              </div>
            ))}
            <div style={{ fontSize: 11, color: C.amber, fontWeight: 700, textAlign: "center", marginTop: 4 }}>${totalEarnings} total earned</div>
          </div>
        </div>

        {/* Earnings */}
        <div style={{ background: C.white, border: "1px solid "+C.concrete, borderRadius: 10, padding: "10px 10px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: C.navy, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid "+C.amber }}>💰 Earnings</div>

          {/* Stripe Connect payout status — gates whether this host can actually get paid out */}
          {!stripeStatus.loading && (
            stripeStatus.payoutsEnabled ? (
              <div style={{ display: "flex", alignItems: "center", gap: 5, background: C.mossLight, border: "1px solid "+C.moss, borderRadius: 6, padding: "5px 7px", marginBottom: 6 }}>
                <span style={{ fontSize: 11 }}>✅</span>
                <span style={{ fontSize: 9, color: C.moss, fontWeight: 700 }}>Payouts active</span>
              </div>
            ) : (
              <div style={{ background: C.amberLight, border: "1px solid "+C.amber, borderRadius: 6, padding: "6px 7px", marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: C.navy, fontWeight: 700, marginBottom: 4 }}>
                  {stripeStatus.accountId ? "⏳ Finish Stripe verification to get paid" : "⚠️ Set up payouts to get paid for bookings"}
                </div>
                <button onClick={connectStripe} disabled={connecting} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 6, padding: "4px 8px", fontSize: 9, fontWeight: 700, cursor: connecting ? "default" : "pointer", opacity: connecting ? 0.6 : 1 }}>
                  {connecting ? "Redirecting…" : stripeStatus.accountId ? "Finish setup →" : "Connect with Stripe →"}
                </button>
                {connectError && <div style={{ fontSize: 8, color: C.red, marginTop: 4 }}>{connectError}</div>}
              </div>
            )
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 6 }}>
            {[
              { label: "This month", value: txLoading ? "…" : money(thisMonthEarned) },
              { label: "Last month", value: txLoading ? "…" : money(lastMonthEarned) },
              { label: "All time", value: txLoading ? "…" : money(allTimeEarned) },
              { label: "Next payout", value: txLoading ? "…" : nextPayout ? money(nextPayout.amount) : "—" },
            ].map(s => (
              <div key={s.label} style={{ background: C.warmWhite, borderRadius: 6, padding: "5px 7px" }}>
                <div style={{ fontSize: 8, color: C.muted }}>{s.label}</div>
                <div style={{ fontWeight: 800, fontSize: 13, color: C.amber }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Transactions */}
        <div style={{ background: C.white, border: "1px solid "+C.concrete, borderRadius: 10, padding: "10px 10px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingBottom: 6, borderBottom: "2px solid "+C.amber }}>
            <div style={{ fontWeight: 700, fontSize: 11, color: C.navy, textTransform: "uppercase", letterSpacing: "0.06em" }}>🧾 Recent Transactions</div>
            {setTab && <button onClick={() => setTab("Transactions")} style={{ background: "none", border: "none", color: C.amber, fontWeight: 700, fontSize: 10, cursor: "pointer" }}>View all →</button>}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
            {txLoading && <div style={{ fontSize: 10, color: C.muted, padding: "6px 0" }}>Loading…</div>}
            {!txLoading && txData.earned.length === 0 && <div style={{ fontSize: 10, color: C.muted, padding: "6px 0" }}>No transactions yet.</div>}
            {!txLoading && txData.earned.slice(0, 5).map(t => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", borderBottom: "1px solid "+C.concrete }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.navy }}>{t.description}</div>
                  <div style={{ fontSize: 9, color: C.muted }}>{new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 11, color: C.moss }}>+{money(t.net)}</div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {editingListing && (
        <EditListingModal
          listing={editingListing}
          onClose={() => setEditingListing(null)}
          onSave={saveListingEdit}
        />
      )}
    </div>
  );
}
// ─── Messages Inbox ───────────────────────────────────────────────────────────
function MessagesView({ onOpenThread, user }) {
  const [dbConvos, setDbConvos] = useState([]);

  useEffect(() => {
    if (!user) return;
    // Pull every message the user sent or received (as the listing's host),
    // newest first, then collapse to one row per listing.
    supabase
      .from("messages")
      .select("*, listings(*, profiles(name))")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error || !data) return;
        const seen = new Set();
        const convos = [];
        for (const row of data) {
          const listingHostId = row.listings?.host_id;
          const isParticipant = row.sender_id === user.id || listingHostId === user.id;
          if (!isParticipant || seen.has(row.listing_id)) continue;
          seen.add(row.listing_id);
          convos.push({
            id: "db-" + row.listing_id,
            title: row.listings?.title || "Listing",
            host: row.listings?.profiles?.name || "Host",
            hostImg: "🧑",
            preview: row.text,
          });
        }
        setDbConvos(convos);
      });
  }, [user]);

  const conversations = dbConvos;

  return (
    <div style={{ padding: "24px 20px", fontFamily: "'Poppins', sans-serif", maxWidth: 560, margin: "0 auto" }}>
      <h2 style={{ fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 22, marginBottom: 4 }}>Messages</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>Your conversations with hosts.</p>
      {conversations.length === 0 && (
        <div style={{ textAlign: "center", color: C.muted, fontSize: 13, marginTop: 24 }}>No conversations yet.</div>
      )}
      {conversations.map(l => (
        <div key={l.id} onClick={() => onOpenThread(l)} style={{ background: C.white, border: "1px solid "+C.concrete, borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: "box-shadow 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 14px rgba(27,42,59,0.08)"}
          onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{l.hostImg}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.navy }}>{l.host}</div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{l.title}</div>
            <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.preview}</div>
          </div>
          <div style={{ fontSize: 16, color: C.muted, flexShrink: 0 }}>›</div>
        </div>
      ))}
    </div>
  );
}

// Shared driveway frame — renders the reference photo you supplied as the
// background (road, sidewalk, hedges, and garage baked into the image
// itself) and positions spot tiles precisely over the pavement region.
// Add the image file to your repo at: public/driveway-template.png
const DRIVEWAY_IMG = "/driveway-template.png";
const DRIVEWAY_ASPECT = 1065 / 1477; // matches the Garage-top template image's own width/height

// Pavement boundary, measured pixel-for-pixel from the template photo (as a % of
// the frame's total width/height). This is the ONLY place that needs updating if
// the template image is ever swapped — every driveway view in the app (host
// spot-marking, renter spot picker, booking summary) reads from here, so tiles
// stay correctly scaled and positioned on the pavement everywhere at once.
const DRIVEWAY_PAVEMENT = { top: "16%", left: "23%", right: "24%", bottom: "18%" };

function DrivewayFrame({ children }) {
  return (
    <div style={{
      position: "relative", width: "100%", maxWidth: "100%", aspectRatio: DRIVEWAY_ASPECT, boxSizing: "border-box",
      flexShrink: 0, flexGrow: 0, flexBasis: "auto", alignSelf: "stretch",
      borderRadius: 18, overflow: "hidden", border: "3px solid " + C.navy, boxShadow: "0 6px 18px rgba(28,43,57,0.18)",
      backgroundImage: `url(${DRIVEWAY_IMG})`, backgroundSize: "100% 100%", backgroundRepeat: "no-repeat", backgroundColor: "#EFEAE0",
    }}>
      {/* Pavement region — reads from DRIVEWAY_PAVEMENT above so it's consistent everywhere */}
      <div style={{ position: "absolute", ...DRIVEWAY_PAVEMENT, display: "flex", alignItems: "center", justifyContent: "center", padding: "3% 4%", boxSizing: "border-box", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

// Renter-facing version: shows which spots are for rent, lets the driver pick theirs.
function SpotPicker({ availableCount, chosen, onChoose, spotStates, spotStatus }) {
  const labels = ["A", "B", "C", "D"];
  return (
    <DrivewayFrame>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: "3%", width: "86%", height: "90%", maxWidth: "86%", margin: "0 auto", boxSizing: "border-box", overflow: "hidden" }}>
        {labels.map((l, i) => {
          const hostEnabled = spotStates ? !!spotStates[i] : i < availableCount;
          // spotStatus is live, time-window-specific data from
          // /api/listing-availability — undefined while it's still loading
          // (or for older callers that don't pass it), in which case we
          // don't want to flash every spot as unavailable for a moment, so
          // that case defaults to "no live data yet, don't block."
          const liveFree = spotStatus ? spotStatus[l] !== false : true;
          const isAvailable = hostEnabled && liveFree;
          const isChosen = chosen === i;
          return (
            <button key={l} disabled={!isAvailable} onClick={() => isAvailable && onChoose(i)} style={{
              borderRadius: 10, cursor: isAvailable ? "pointer" : "default", minWidth: 0, minHeight: 0, width: "100%", height: "100%", boxSizing: "border-box",
              border: isChosen ? "4px solid " + C.hazard : "3px solid " + (isAvailable ? C.moss : "#B0AA9C"),
              background: isChosen ? C.mossLight : isAvailable ? "#F7F3E7" : "#EAE6DA", opacity: isAvailable ? 1 : 0.8,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "3% 3%", overflow: "hidden",
              fontFamily: "'Poppins', sans-serif", color: C.navy, transition: "all 0.15s",
              boxShadow: isChosen ? "0 3px 10px rgba(226,87,28,0.35)" : "0 2px 6px rgba(0,0,0,0.12)",
            }}>
              <span style={{ fontWeight: 800, fontSize: 13, whiteSpace: "nowrap", flexShrink: 0 }}>Spot {l}</span>
              {isAvailable ? (
                <img src="/car-icon.png" alt="" style={{ width: "44%", maxWidth: 54, flexShrink: 0, objectFit: "contain" }} />
              ) : (
                <span style={{ fontSize: 42, flexShrink: 0, lineHeight: 1 }}>🚫</span>
              )}
              <span style={{ fontSize: 9, fontWeight: 800, textAlign: "center", lineHeight: 1.15, flexShrink: 0, color: isChosen ? C.hazard : isAvailable ? C.moss : C.muted }}>{isChosen ? "Your spot" : isAvailable ? "Available" : !hostEnabled ? "Not for rent" : "Already booked"}</span>
            </button>
          );
        })}
      </div>
    </DrivewayFrame>
  );
}

// ─── Driveway spot template ────────────────────────────────────────────────────
function DrivewaySpotMap({ total, selected, onToggle }) {
  const labels = Array.from({ length: total }, (_, i) => String.fromCharCode(65 + i));
  const cols = total <= 1 ? 1 : 2;
  const rows = Math.ceil(total / cols);
  return (
    <DrivewayFrame>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, gap: "3%", width: "86%", height: "90%", maxWidth: "86%", margin: "0 auto", boxSizing: "border-box", overflow: "hidden" }}>
        {labels.map((l, i) => {
          const on = !!selected[i];
          return (
            <button key={l} onClick={() => onToggle(i)} style={{
              position: "relative", borderRadius: 10, cursor: "pointer", minWidth: 0, minHeight: 0, width: "100%", height: "100%", boxSizing: "border-box",
              background: on ? "#F7F3E7" : "#EAE6DA", border: "3px solid " + (on ? C.moss : "#B0AA9C"),
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "3% 3%", overflow: "hidden",
              fontFamily: "'Poppins', sans-serif", transition: "all 0.15s", boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
            }}>
              <span style={{ fontWeight: 800, fontSize: 13, color: C.navy, whiteSpace: "nowrap", flexShrink: 0 }}>Spot {l}</span>
              {on ? (
                <img src="/car-icon.png" alt="" style={{ width: "44%", maxWidth: 54, flexShrink: 0, objectFit: "contain" }} />
              ) : (
                <span style={{ fontSize: 42, flexShrink: 0, lineHeight: 1 }}>🔒</span>
              )}
              <span style={{ fontSize: 9, fontWeight: 800, color: on ? C.moss : C.muted, letterSpacing: "0.02em", textAlign: "center", lineHeight: 1.15, flexShrink: 0 }}>{on ? "FOR RENT" : "PRIVATE"}</span>
            </button>
          );
        })}
      </div>
    </DrivewayFrame>
  );
}


// ─── Driveway spot template — satellite view ───────────────────────────────────
// Lets a host draw a box over their actual driveway (aerial imagery) for each
// parking spot they're offering, instead of guessing at an abstract grid.
const SPOT_FILL_RENT = "rgba(63,122,94,0.35)";   // moss green — for rent
const SPOT_FILL_PRIVATE = "rgba(28,43,57,0.35)"; // navy — private / not for rent
const SPOT_STROKE_RENT = "#3F7A5E";
const SPOT_STROKE_PRIVATE = "#0E1B2E";

function DrivewaySpotSatelliteMap({ center, spots, onAddSpot, onToggleSpot, onRemoveSpot, maxSpots = 8 }) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  const [drawing, setDrawing] = useState(false);
  const mapRef = useRef(null);

  const boxStyle = { width: "100%", height: 320, borderRadius: 14, background: "#F4F1E8", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13, textAlign: "center", padding: 16 };

  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) return <div style={boxStyle}>Satellite view unavailable — missing Google Maps API key</div>;
  if (loadError) return <div style={boxStyle}>Couldn't load satellite imagery</div>;
  if (!isLoaded) return <div style={boxStyle}>Loading satellite imagery…</div>;

  const onRectangleComplete = (rect) => {
    const b = rect.getBounds();
    const ne = b.getNorthEast(), sw = b.getSouthWest();
    onAddSpot({ north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() });
    rect.setMap(null); // remove the raw drawing-tool rectangle; we render our own below
    setDrawing(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ borderRadius: 14, overflow: "hidden", border: "3px solid " + C.navy, boxShadow: "0 6px 18px rgba(28,43,57,0.18)" }}>
        <GoogleMap
          mapContainerStyle={{ width: "100%", height: 320 }}
          center={center}
          zoom={19}
          mapTypeId="satellite"
          onLoad={(map) => { mapRef.current = map; }}
          options={{ disableDefaultUI: true, zoomControl: true, tilt: 0, clickableIcons: false }}
        >
          <DrawingManager
            drawingMode={drawing ? window.google.maps.drawing.OverlayType.RECTANGLE : null}
            onRectangleComplete={onRectangleComplete}
            options={{
              drawingControl: false,
              rectangleOptions: { fillColor: SPOT_STROKE_RENT, fillOpacity: 0.35, strokeColor: SPOT_STROKE_RENT, strokeWeight: 2, clickable: false, editable: false },
            }}
          />
          {spots.map((s) => (
            <Rectangle
              key={s.id}
              bounds={s.bounds}
              options={{
                fillColor: s.forRent ? SPOT_STROKE_RENT : SPOT_STROKE_PRIVATE,
                fillOpacity: 0.35,
                strokeColor: s.forRent ? SPOT_STROKE_RENT : SPOT_STROKE_PRIVATE,
                strokeWeight: 2,
                clickable: true,
              }}
              onClick={() => onToggleSpot(s.id)}
            />
          ))}
          {spots.map((s, i) => {
            const cLat = (s.bounds.north + s.bounds.south) / 2, cLng = (s.bounds.east + s.bounds.west) / 2;
            return (
              <OverlayView key={"lbl-" + s.id} position={{ lat: cLat, lng: cLng }} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
                <div style={{ transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, pointerEvents: "none" }}>
                  <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 11, color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
                    Spot {String.fromCharCode(65 + i)} {s.forRent ? "· FOR RENT" : "· PRIVATE"}
                  </span>
                  <button onClick={() => onRemoveSpot(s.id)} style={{ pointerEvents: "auto", width: 18, height: 18, borderRadius: "50%", background: "rgba(28,43,57,0.85)", color: "#fff", border: "none", fontSize: 11, cursor: "pointer", lineHeight: "18px" }}>×</button>
                </div>
              </OverlayView>
            );
          })}
        </GoogleMap>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, color: C.muted }}>Tap a drawn spot to switch it between for-rent and private.</span>
        <button
          onClick={() => setDrawing(d => !d)}
          disabled={spots.length >= maxSpots}
          style={{
            flexShrink: 0, background: drawing ? C.navy : C.amber, color: drawing ? "#fff" : C.navy, border: "none",
            borderRadius: 8, padding: "8px 14px", fontWeight: 700, fontSize: 12, cursor: spots.length >= maxSpots ? "not-allowed" : "pointer",
            opacity: spots.length >= maxSpots ? 0.5 : 1, fontFamily: "'Poppins', sans-serif",
          }}
        >
          {drawing ? "Cancel drawing" : spots.length === 0 ? "✏️ Draw your first spot" : "+ Draw another spot"}
        </button>
      </div>
    </div>
  );
}

// ─── List Driveway ────────────────────────────────────────────────────────────
function PinAdjustMap({ lat, lng, onChange }) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY || typeof lat !== "number" || typeof lng !== "number" || loadError) return null;
  if (!isLoaded) {
    return <div style={{ width: "100%", height: 200, borderRadius: 12, background: "#F4F1E8", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 13 }}>Loading map…</div>;
  }
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", border: "2px solid " + C.navy }}>
      <GoogleMap
        mapContainerStyle={{ width: "100%", height: 200 }}
        center={{ lat, lng }}
        zoom={19}
        mapTypeId="satellite"
        options={{ disableDefaultUI: true, zoomControl: true, tilt: 0, clickableIcons: false }}
      >
        <Marker
          position={{ lat, lng }}
          draggable
          onDragEnd={(e) => onChange({ lat: e.latLng.lat(), lng: e.latLng.lng() })}
        />
      </GoogleMap>
    </div>
  );
}
function ListDrivewayView({ user }) {
  const [step, setStep] = useState(1);
  const [publishError, setPublishError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [form, setForm] = useState({
    street: "", city: "", region: "", postal: "", docType: "tax", ownerFileName: "", verifying: false, verified: false, verifySkipped: false,
    photos: [], totalSpots: 3, selectedSpots: [true, true, false], spots: [],
    price: "", covered: false, cctv: false, lighting: false, snowRemoval: false, evCharging: false, gated: false, access: "24hr", description: "",
  });
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSug, setLoadingSug] = useState(false);
  const debounceRef = useRef(null);
  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inputStyle = { width: "100%", border: "1px solid "+C.concrete, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: C.navy, fontFamily: "'Poppins', sans-serif", boxSizing: "border-box", outline: "none" };
  const labelStyle = { fontSize: 12, color: C.muted, display: "block", marginBottom: 6, fontWeight: 600 };
  const fullAddress = [form.street, form.city, [form.region, form.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  const searchAddress = (val) => {
    update("street", val);
    setSuggestions([]);
    clearTimeout(debounceRef.current);
    if (val.length < 3) { setLoadingSug(false); return; }
    setLoadingSug(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=" + encodeURIComponent(val), { headers: { "Accept-Language": "en" } });
        const data = await res.json();
        setSuggestions(data.map(d => ({
          label: [d.address.house_number, d.address.road, d.address.city || d.address.town || d.address.suburb, d.address.state].filter(Boolean).join(", "),
          street: [d.address.house_number, d.address.road].filter(Boolean).join(" "),
          city: d.address.city || d.address.town || d.address.suburb || d.address.village || "",
          region: d.address.state || d.address.state_district || "",
          postal: d.address.postcode || "",
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
        })));
      } catch (e) { setSuggestions([]); }
      setLoadingSug(false);
    }, 350);
  };
  const chooseSuggestion = (s) => { setForm(f => ({ ...f, street: s.street, city: s.city, region: s.region, postal: s.postal, lat: s.lat, lng: s.lng })); setSuggestions([]); };

  const submitVerification = () => {
    update("verifying", true);
    setTimeout(() => setForm(f => ({ ...f, verifying: false, verified: true })), 1600);
  };

  const addPhotos = (files) => {
    Array.from(files).slice(0, 6 - form.photos.length).forEach(file => {
      const reader = new FileReader();
      reader.onload = e => setForm(f => ({ ...f, photos: [...f.photos, { name: file.name, url: e.target.result }] }));
      reader.readAsDataURL(file);
    });
  };
  const removePhoto = (i) => setForm(f => ({ ...f, photos: f.photos.filter((_, idx) => idx !== i) }));

  const toggleSpot = (i) => setForm(f => { const s = [...f.selectedSpots]; s[i] = !s[i]; return { ...f, selectedSpots: s }; });
  const setTotalSpots = (n) => setForm(f => {
    const totalSpots = Math.max(1, Math.min(8, n));
    const selectedSpots = Array.from({ length: totalSpots }, (_, i) => f.selectedSpots[i] ?? true);
    return { ...f, totalSpots, selectedSpots };
  });

  // Satellite-drawn spots keep totalSpots/selectedSpots in sync so pricing (step 6)
  // and publish() — which only look at those two fields — work unchanged.
  const syncSpots = (f, spots) => ({ ...f, spots, totalSpots: Math.max(spots.length, 1), selectedSpots: spots.length ? spots.map(s => s.forRent) : [true] });
  const addSatelliteSpot = (bounds) => setForm(f => {
    if (f.spots.length >= 8) return f;
    const spots = [...f.spots, { id: Date.now() + Math.random(), bounds, forRent: true }];
    return syncSpots(f, spots);
  });
  const toggleSatelliteSpot = (id) => setForm(f => syncSpots(f, f.spots.map(s => s.id === id ? { ...s, forRent: !s.forRent } : s)));
  const removeSatelliteSpot = (id) => setForm(f => syncSpots(f, f.spots.filter(s => s.id !== id)));

  const [submitted, setSubmitted] = useState(false);

  const publish = async () => {
    if (!form.price) update("price", "12");
    setPublishError("");
    if (!user) {
      setPublishError("Please sign in as a host before publishing your listing.");
      return;
    }
    setPublishing(true);
    const rentableSpots = form.selectedSpots.filter(Boolean).length || 1;
    const features = [
      form.covered && "Covered",
      form.cctv && "CCTV",
      form.lighting && "Well-lit",
      form.gated && "Gated",
      form.access === "24hr" && "24hr Access",
    ].filter(Boolean);
    const { error } = await supabase.from("listings").insert({
      host_id: user.id,
      title: fullAddress ? "Driveway at " + form.street : "New driveway listing",
      address: fullAddress,
      price: Number(form.price) || 12,
      spaces: rentableSpots,
      features,
      description: form.description || "",
      img: form.photos[0]?.url || "🏠",
      photos: form.photos.map(p => p.url),
      lat: form.lat || null,
      lng: form.lng || null,
      spots: form.spots || [],
    });
    setPublishing(false);
    if (error) {
      setPublishError(error.message);
      return;
    }
    setSubmitted(true);
  };

  const resetAll = () => {
    setSubmitted(false); setStep(1);
    setForm({ street: "", city: "", region: "", postal: "", docType: "tax", ownerFileName: "", verifying: false, verified: false, verifySkipped: false, photos: [], totalSpots: 3, selectedSpots: [true, true, false], spots: [], price: "", covered: false, cctv: false, lighting: false, snowRemoval: false, evCharging: false, gated: false, access: "24hr", description: "" });
  };

  if (submitted) {
    const rentable = form.selectedSpots.filter(Boolean).length;
    return (
      <div style={{ padding: 28, textAlign: "center", fontFamily: "'Poppins', sans-serif", maxWidth: 500, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <img src={PARKER.success} alt="Parker giving thumbs up" style={{ height: 110, width: "auto", marginBottom: 16 }} />
        </div>
        <h2 style={{ fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 26, marginBottom: 8 }}>You're listed!</h2>
        <p style={{ color: C.muted, marginBottom: 24 }}>Your driveway at <strong>{fullAddress}</strong> — {rentable} spot{rentable !== 1 ? "s" : ""} for rent — is live at <strong style={{ color: C.amber }}>${form.price}/hr</strong>.</p>
        <Btn onClick={resetAll}>List another driveway</Btn>
      </div>
    );
  }

  const steps = [{ label: "Location", num: 1 }, { label: "Verify", num: 2 }, { label: "Photos", num: 3 }, { label: "Spots", num: 4 }, { label: "Details", num: 5 }, { label: "Pricing", num: 6 }];
  const docTypes = [{ v: "tax", l: "Property tax bill" }, { v: "mortgage", l: "Mortgage statement" }, { v: "utility", l: "Utility bill" }, { v: "license", l: "Driver's license" }, { v: "bank", l: "Bank statement" }];

  return (
    <div style={{ padding: "24px 28px", fontFamily: "'Poppins', sans-serif", maxWidth: 560, margin: "0 auto" }}>
      <h2 style={{ fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 22, marginBottom: 6 }}>List your driveway</h2>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 24 }}>Earn extra income from your empty driveway. We verify ownership to keep the marketplace trustworthy.</p>

      {/* Progress */}
      <div style={{ display: "flex", gap: 0, marginBottom: 10 }}>
        {steps.map((s, i) => (
          <div key={s.num} style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: step >= s.num ? C.navy : C.concrete, color: step >= s.num ? C.white : C.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{step > s.num ? "✓" : s.num}</div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: 2, background: step > s.num ? C.navy : C.concrete, margin: "0 4px" }} />}
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", fontSize: 12, fontWeight: 700, color: C.navy, marginBottom: 24 }}>Step {step} of {steps.length} · {steps[step-1].label}</div>

      {/* Step 1: Location */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ position: "relative" }}>
            <label style={labelStyle}>Street address</label>
            <input style={inputStyle} placeholder="Start typing your address…" value={form.street} onChange={e => searchAddress(e.target.value)} />
            {loadingSug && <span style={{ position: "absolute", right: 14, top: 38, fontSize: 12 }}>⏳</span>}
            {suggestions.length > 0 && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: C.white, border: "1.5px solid "+C.concrete, borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.14)", zIndex: 50, overflow: "hidden" }}>
                {suggestions.map((s, i) => (
                  <div key={i} onClick={() => chooseSuggestion(s)} style={{ padding: "10px 12px", borderBottom: i < suggestions.length - 1 ? "1px solid "+C.concrete : "none", cursor: "pointer", fontSize: 13, color: C.navy, display: "flex", gap: 8 }}>
                    <span>📍</span><span>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}><label style={labelStyle}>City</label><input style={inputStyle} placeholder="e.g. Brooklyn" value={form.city} onChange={e => update("city", e.target.value)} /></div>
            <div style={{ flex: 1 }}><label style={labelStyle}>State / Province</label><input style={inputStyle} placeholder="e.g. NY" value={form.region} onChange={e => update("region", e.target.value)} /></div>
          </div>
          <div><label style={labelStyle}>Postal / ZIP code</label><input style={{ ...inputStyle, maxWidth: 200 }} placeholder="e.g. 11201" value={form.postal} onChange={e => update("postal", e.target.value)} /></div>
          {form.street && form.city && form.region && form.postal && suggestions.length === 0 && (
                <div style={{ background: C.mossLight, border: "1px solid "+C.moss, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: C.moss, fontWeight: 600 }}>✓ Address confirmed: {fullAddress}</div>
              )}
              {form.lat && form.lng && import.meta.env.VITE_GOOGLE_MAPS_API_KEY && (
                <div>
                  <label style={labelStyle}>Fine-tune pin location</label>
                  <p style={{ fontSize: 12, color: C.muted, margin: "0 0 8px" }}>Drag the pin if the satellite view doesn't line up with your driveway.</p>
                  <PinAdjustMap lat={form.lat} lng={form.lng} onChange={({ lat, lng }) => setForm(f => ({ ...f, lat, lng }))} />
                </div>
              )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button onClick={() => setStep(2)} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Skip for now</button>
            <Btn onClick={() => setStep(2)} disabled={!form.street || !form.city || !form.region || !form.postal}>Continue →</Btn>
          </div>
        </div>
      )}

      {/* Step 2: Ownership verification */}
      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>To protect renters, we confirm you own or manage this property before your listing goes live.</p>
          <div><label style={labelStyle}>Proof of ownership document</label>
            <select style={inputStyle} value={form.docType} onChange={e => update("docType", e.target.value)}>
              {docTypes.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Upload document</label>
            <label style={{ display: "flex", alignItems: "center", gap: 10, border: "1.5px dashed "+C.concrete, borderRadius: 10, padding: "14px 16px", cursor: "pointer", background: C.warmWhite }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <span style={{ fontSize: 13, color: form.ownerFileName ? C.navy : C.muted, fontWeight: form.ownerFileName ? 700 : 400 }}>{form.ownerFileName || "Choose a file (PDF or image)…"}</span>
              <input type="file" accept="image/*,.pdf" style={{ display: "none" }} onChange={e => e.target.files[0] && update("ownerFileName", e.target.files[0].name)} />
            </label>
          </div>
          {!form.verified && !form.verifySkipped ? (
            <Btn variant="amber" onClick={submitVerification} disabled={!form.ownerFileName || form.verifying} full>
              {form.verifying ? "Verifying…" : "Submit for verification"}
            </Btn>
          ) : form.verified ? (
            <div style={{ background: C.mossLight, border: "1px solid "+C.moss, borderRadius: 10, padding: "12px 16px", fontSize: 13, color: C.moss, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>✅ Ownership verified</div>
          ) : (
            <div style={{ background: C.amberLight, border: "1px solid "+C.amber, borderRadius: 10, padding: "12px 16px", fontSize: 13, color: C.navy, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>⏳ Verification skipped — finish this later from your host dashboard.</div>
          )}
          {!form.verified && !form.verifySkipped && (
            <button onClick={() => { update("verifySkipped", true); setStep(3); }} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, fontWeight: 600, textDecoration: "underline", cursor: "pointer", alignSelf: "center" }}>Skip for now</button>
          )}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Btn variant="pill" onClick={() => setStep(1)}>← Back</Btn>
            <Btn onClick={() => setStep(3)} disabled={!form.verified && !form.verifySkipped}>Continue →</Btn>
          </div>
        </div>
      )}

      {/* Step 3: Photos */}
      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <label style={labelStyle}>Photos of your driveway ({form.photos.length}/6)</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {form.photos.map((p, i) => (
              <div key={i} style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: "1.5px solid "+C.concrete, height: 90 }}>
                <img src={p.url} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                <button onClick={() => removePhoto(i)} style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "rgba(28,43,57,0.75)", color: C.white, border: "none", fontSize: 12, cursor: "pointer" }}>×</button>
              </div>
            ))}
            {form.photos.length < 6 && (
              <label style={{ height: 90, borderRadius: 10, border: "1.5px dashed "+C.concrete, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", color: C.muted, fontSize: 11, background: C.warmWhite }}>
                <span style={{ fontSize: 22 }}>📷</span>Add photo
                <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => addPhotos(e.target.files)} />
              </label>
            )}
          </div>
          <p style={{ fontSize: 11, color: C.muted, margin: 0 }}>Clear daytime photos of the driveway entrance and full length help renters trust your listing.</p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Btn variant="pill" onClick={() => setStep(2)}>← Back</Btn>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button onClick={() => setStep(4)} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Skip for now</button>
              <Btn onClick={() => setStep(4)} disabled={form.photos.length === 0}>Continue →</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Spot template */}
      {step === 4 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {form.lat && form.lng && import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? (
            <SpotMapBoundary fallback={
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>How many spots does your driveway have?</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button onClick={() => setTotalSpots(form.totalSpots - 1)} style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid "+C.concrete, background: C.white, cursor: "pointer", fontWeight: 700, color: C.navy }}>–</button>
                    <span style={{ fontWeight: 800, color: C.navy, fontSize: 15, minWidth: 14, textAlign: "center" }}>{form.totalSpots}</span>
                    <button onClick={() => setTotalSpots(form.totalSpots + 1)} style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid "+C.concrete, background: C.white, cursor: "pointer", fontWeight: 700, color: C.navy }}>+</button>
                  </div>
                </div>
                <div style={{ background: C.amberLight, border: "1px solid "+C.amber, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: C.navy, fontWeight: 600, margin: "8px 0" }}>⚠️ Couldn't load the satellite photo, so use this simple layout instead.</div>
                <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>Your driveway is gridded into {form.totalSpots} section{form.totalSpots !== 1 ? "s" : ""}. Tap a spot to mark it available for rent — leave the ones you still need for your own car as private.</p>
                <DrivewaySpotMap total={form.totalSpots} selected={form.selectedSpots} onToggle={toggleSpot} />
                <div style={{ fontSize: 12, color: C.navy, fontWeight: 700, textAlign: "center" }}>{form.selectedSpots.filter(Boolean).length} of {form.totalSpots} spots available for rent</div>
              </>
            }>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Mark your parking spots on the aerial photo</label>
              <p style={{ fontSize: 12, color: C.muted, margin: "6px 0" }}>This is the actual satellite view of your driveway at <strong>{fullAddress}</strong>. Draw a box over each space you want to rent out — leave the ones you still need for your own car unmarked or set to private.</p>
              <DrivewaySpotSatelliteMap
                center={{ lat: form.lat, lng: form.lng }}
                spots={form.spots}
                onAddSpot={addSatelliteSpot}
                onToggleSpot={toggleSatelliteSpot}
                onRemoveSpot={removeSatelliteSpot}
                maxSpots={8}
              />
              <div style={{ fontSize: 12, color: C.navy, fontWeight: 700, textAlign: "center", marginTop: 10 }}>{form.selectedSpots.filter(Boolean).length} of {form.spots.length || 0} marked spot{form.spots.length !== 1 ? "s" : ""} available for rent</div>
            </SpotMapBoundary>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>How many spots does your driveway have?</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => setTotalSpots(form.totalSpots - 1)} style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid "+C.concrete, background: C.white, cursor: "pointer", fontWeight: 700, color: C.navy }}>–</button>
                  <span style={{ fontWeight: 800, color: C.navy, fontSize: 15, minWidth: 14, textAlign: "center" }}>{form.totalSpots}</span>
                  <button onClick={() => setTotalSpots(form.totalSpots + 1)} style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid "+C.concrete, background: C.white, cursor: "pointer", fontWeight: 700, color: C.navy }}>+</button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>{form.street ? "We couldn't load satellite imagery for your address, so use this simple layout instead. " : "Add your address in step 1 to mark spots on an aerial photo of your actual driveway. For now, use this simple layout: "}your driveway is gridded into {form.totalSpots} section{form.totalSpots !== 1 ? "s" : ""}. Tap a spot to mark it available for rent — leave the ones you still need for your own car as private.</p>
              <DrivewaySpotMap total={form.totalSpots} selected={form.selectedSpots} onToggle={toggleSpot} />
              <div style={{ fontSize: 12, color: C.navy, fontWeight: 700, textAlign: "center" }}>{form.selectedSpots.filter(Boolean).length} of {form.totalSpots} spots available for rent</div>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Btn variant="pill" onClick={() => setStep(3)}>← Back</Btn>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button onClick={() => setStep(5)} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Skip for now</button>
              <Btn onClick={() => setStep(5)} disabled={form.selectedSpots.filter(Boolean).length === 0}>Continue →</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Details */}
      {step === 5 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div><label style={labelStyle}>Features</label>
            {[{key:"covered",label:"Covered / garage"},{key:"cctv",label:"CCTV / security camera"},{key:"lighting",label:"Well-lit at night"},{key:"snowRemoval",label:"Snow removal in winter"},{key:"evCharging",label:"EV charging available"},{key:"gated",label:"Gated access"}].map(({key,label}) => (
              <label key={key} style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", marginBottom:8 }}>
                <input type="checkbox" checked={form[key]} onChange={e => update(key, e.target.checked)} />
                <span style={{ fontSize:14, color:C.navy }}>{label}</span>
              </label>
            ))}
          </div>
          <div><label style={labelStyle}>Access hours</label>
            <select style={inputStyle} value={form.access} onChange={e => update("access", e.target.value)}>
              <option value="24hr">24 hours / 7 days</option>
              <option value="daytime">Daytime only (7am–9pm)</option>
              <option value="weekends">Weekends only</option>
            </select>
          </div>
          <div><label style={labelStyle}>Description (optional)</label><textarea style={{ ...inputStyle, resize:"vertical", minHeight:80 }} placeholder="Anything useful for drivers to know…" value={form.description} onChange={e => update("description", e.target.value)} /></div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems: "center" }}>
            <Btn variant="pill" onClick={() => setStep(4)}>← Back</Btn>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button onClick={() => setStep(6)} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Skip for now</button>
              <Btn onClick={() => setStep(6)}>Continue →</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Step 6: Pricing */}
      {step === 6 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>Hourly rate (USD)</label>
            <div style={{ position:"relative" }}>
              <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:C.muted }}>$</span>
              <input style={{ ...inputStyle, paddingLeft:28 }} type="number" min="1" max="200" placeholder="e.g. 12" value={form.price} onChange={e => update("price", e.target.value)} />
            </div>
            <p style={{ fontSize:12, color:C.muted, marginTop:6 }}>Driveways in your area average $11–$18/hr.</p>
          </div>
          {form.price && (
            <ParkerTip pose="success">
              This driveway could earn its owner over <strong>${(form.price * 20 * form.selectedSpots.filter(Boolean).length * 12).toLocaleString()}</strong> this year, based on ~20 hrs booked per month per rentable spot. <em style={{ opacity: 0.75, fontStyle: "normal", fontWeight: 500 }}>(Estimate only.)</em>
            </ParkerTip>
          )}
          {publishError && <div style={{ color: C.red, fontSize: 12.5, textAlign: "right" }}>{publishError}</div>}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems: "center" }}>
            <Btn variant="pill" onClick={() => setStep(5)}>← Back</Btn>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button onClick={publish} style={{ background: "none", border: "none", color: C.muted, fontSize: 12, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Skip for now</button>
              <Btn variant="amber" onClick={publish} disabled={!form.price || publishing}>{publishing ? "Publishing…" : "Publish listing"}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Opens the renter's own Maps app for real turn-by-turn navigation — true
// in-app turn-by-turn (voice guidance, live rerouting) requires a native
// mobile SDK that doesn't exist for web apps, so handing off to the
// device's own Maps app is the standard, reliable approach every major app
// in this space (Uber, Airbnb, DoorDash) actually uses. Apple Maps on iOS
// (the OS default), Google Maps everywhere else (opens the native app on
// Android, falls back to Google Maps in the browser on desktop). Prefers
// exact coordinates when the listing has them, falls back to the street
// address otherwise.
function buildNavigationUrl(address, lat, lng) {
  const hasCoords = typeof lat === "number" && typeof lng === "number";
  const dest = hasCoords ? `${lat},${lng}` : encodeURIComponent(address || "");
  const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  return isIOS
    ? `https://maps.apple.com/?daddr=${dest}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

// ─── My Bookings ──────────────────────────────────────────────────────────────
function MyBookingsView({ onMessage, user, highlightBookingId }) {
  const [dbBookings, setDbBookings] = useState([]);
  const highlightRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("bookings")
      .select("*, listings(*)")
      .eq("renter_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error || !data) return;
        setDbBookings(
          data.map(row => ({
            id: "db-" + row.id,
            rawId: row.id, // kept unprefixed so it can be matched against
                            // ?view_booking={booking.id} links from emails,
                            // which carry the raw bookings.id, not this
                            // component's "db-"-prefixed local id.
            listing: {
              id: "db-" + row.listing_id,
              title: row.listings?.title || "Driveway",
              address: row.listings?.address || "",
              img: row.listings?.img || "🏠",
              lat: row.listings?.lat,
              lng: row.listings?.lng,
            },
            date: new Date(row.created_at).toLocaleDateString(),
            time: row.hours + " hr" + (row.hours === 1 ? "" : "s"),
            total: row.total,
            status: row.status === "confirmed" ? "Upcoming" : row.status === "completed" ? "Completed" : "Cancelled",
            canReview: row.status === "completed",
          }))
        );
      });
  }, [user]);

  // Scroll to and briefly highlight the booking a "View My Reservation"
  // email link pointed at, once it's actually loaded.
  useEffect(() => {
    if (highlightBookingId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightBookingId, dbBookings]);

  const bookings = dbBookings;
  const [reviewTarget, setReviewTarget] = useState(null);
  const [reviewed, setReviewed] = useState({});

  return (
    <div style={{ padding: "24px 20px", fontFamily: "'Poppins', sans-serif", maxWidth: 560, margin: "0 auto" }}>
      <h2 style={{ fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 22, marginBottom: 20 }}>My bookings</h2>
      {bookings.map(b => {
        const isHighlighted = highlightBookingId != null && String(b.rawId) === String(highlightBookingId);
        return (
        <div
          key={b.id}
          ref={isHighlighted ? highlightRef : null}
          style={{
            background: C.white,
            border: isHighlighted ? "2px solid " + C.amber : "1px solid " + C.concrete,
            boxShadow: isHighlighted ? "0 0 0 4px " + C.amberLight : "none",
            borderRadius: 12, padding: "16px 18px", marginBottom: 12, position: "relative", overflow: "hidden",
          }}
        >
          {b.status === "Completed" && (
            <img src={PARKER.success} alt="Parker celebrating a successful booking" style={{ position: "absolute", right: -6, bottom: -6, height: 88, width: "auto", opacity: 0.9, pointerEvents: "none" }} />
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 700, color: C.navy, fontSize: 15, marginBottom: 3 }}>{b.listing.title}</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 5 }}>📍 {b.listing.address}</div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{b.date} · {b.time}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {b.status === "Upcoming" && (
                  <Btn small variant="amber" onClick={() => window.open(buildNavigationUrl(b.listing.address, b.listing.lat, b.listing.lng), "_blank", "noopener,noreferrer")}>🧭 Navigate</Btn>
                )}
                <Btn small variant="outline" onClick={() => onMessage(b.listing)}>💬 Message host</Btn>
                {b.canReview && !reviewed[b.id] && (
                  <Btn small variant="moss" onClick={() => setReviewTarget(b)}>⭐ Review</Btn>
                )}
                {reviewed[b.id] && <span style={{ fontSize: 11, color: C.moss, fontWeight: 600, alignSelf: "center" }}>✓ Reviewed</span>}
              </div>
            </div>
            <div style={{ textAlign: "right", position: "relative", zIndex: 1 }}>
              <Badge color={b.status === "Upcoming" ? C.moss : C.navy}>{b.status}</Badge>
              <div style={{ fontWeight: 800, color: C.amber, fontSize: 18, marginTop: 8 }}>${b.total}</div>
            </div>
          </div>
        </div>
        );
      })}

      {reviewTarget && (
        <ReviewModal
          booking={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onSubmit={() => { setReviewed(r => ({ ...r, [reviewTarget.id]: true })); setReviewTarget(null); }}
          user={user}
        />
      )}
    </div>
  );
}

function ReviewModal({ booking, onClose, onSubmit, user }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const numericId = String(booking.listing.id).startsWith("db-") ? Number(String(booking.listing.id).slice(3)) : null;

  const submit = async () => {
    if (!text.trim()) return;
    setError("");

    if (numericId !== null && user) {
      setSubmitting(true);
      const { error: err } = await supabase.from("reviews").insert({
        listing_id: numericId,
        user_id: user.id,
        rating,
        text: text.trim(),
      });
      setSubmitting(false);
      if (err) {
        setError(err.message);
        return;
      }
    }

    onSubmit();
  };

  return (
    <Modal title={"Review "+booking.listing.title} onClose={onClose}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 8 }}>Your rating</div>
        <div style={{ display: "flex", gap: 6 }}>
          {[1,2,3,4,5].map(n => (
            <button key={n} onClick={() => setRating(n)} style={{ background:"none", border:"none", fontSize:28, cursor:"pointer", color: n <= rating ? C.amber : C.concrete, padding:0 }}>★</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 6 }}>Your review</div>
        <textarea
          value={text} onChange={e => setText(e.target.value)}
          placeholder="Share your experience with this driveway…"
          style={{ width:"100%", border:"1px solid "+C.concrete, borderRadius:8, padding:"10px 14px", fontSize:13, resize:"vertical", minHeight:90, fontFamily:"'Poppins', sans-serif", color:C.navy, outline:"none", boxSizing:"border-box" }}
        />
      </div>
      {error && <div style={{ color: C.red, fontSize: 12, marginBottom: 12 }}>{error}</div>}
      <div style={{ display:"flex", gap:10 }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn variant="moss" full onClick={submit} disabled={!text.trim() || submitting}>{submitting ? "Submitting…" : "Submit review"}</Btn>
      </div>
    </Modal>
  );
}

// ─── Sign In Modal ────────────────────────────────────────────────────────────
function SignInModal({ onClose, onAuth }) {
  const [screen, setScreen] = useState("landing"); // landing | signin | signup | role | disclaimer
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [pendingUser, setPendingUser] = useState(null);
  const [agreed, setAgreed] = useState(false);

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const iS = (err) => ({ width: "100%", border: "1.5px solid " + (err ? C.red : C.concrete), borderRadius: 10, padding: "11px 14px", fontSize: 14, color: C.navy, outline: "none", boxSizing: "border-box", fontFamily: "'Poppins', sans-serif", background: err ? C.redLight : C.white });
  const lS = { fontSize: 12, color: C.muted, fontWeight: 600, display: "block", marginBottom: 5 };

  const validate = () => {
    const e = {};
    if (screen === "signup" && !form.name.trim()) e.name = "Name required";
    if (!form.email.includes("@")) e.email = "Enter a valid email";
    if (form.password.length < 6) e.password = "Min 6 characters";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const [authError, setAuthError] = useState("");

  const submit = async () => {
    if (!validate()) return;
    setAuthError("");
    setLoading(true);

    if (screen === "signin") {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      setLoading(false);
      if (error) {
        setAuthError(error.message);
        return;
      }
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", data.user.id)
        .single();
      if (profileErr || !profile) {
        setAuthError("Signed in, but couldn't load your profile.");
        return;
      }
      onAuth({ id: profile.id, name: profile.name, email: profile.email, role: profile.role });
      onClose();
      return;
    }

    // signup: create the auth user first, decide role next
    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
    });
    setLoading(false);
    if (error) {
      setAuthError(error.message);
      return;
    }
    setPendingUser({ id: data.user.id, name: form.name, email: form.email, role: null });
    setScreen("role");
  };

  const pickRole = (role) => {
    setPendingUser(u => ({ ...u, role }));
    setScreen("disclaimer");
  };

  const finalizeSignup = async () => {
    if (!agreed || !pendingUser) return;
    setLoading(true);
    const { error } = await supabase.from("profiles").insert({
      id: pendingUser.id,
      name: pendingUser.name,
      email: pendingUser.email,
      role: pendingUser.role,
    });
    setLoading(false);
    if (error) {
      setAuthError(error.message);
      return;
    }
    onAuth(pendingUser);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,42,107,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000, padding: 20, fontFamily: "'Poppins', sans-serif" }}>
      <div style={{ background: C.white, borderRadius: 20, width: "100%", maxWidth: 400, boxShadow: "0 24px 64px rgba(0,0,0,0.2)", overflow: "hidden" }}>

        {/* Modal header */}
        <div style={{ background: "linear-gradient(135deg, "+C.navy+", #33465A)", padding: "24px 24px 18px", textAlign: "center", position: "relative" }}>
          <div style={{ fontFamily: "'Poppins', sans-serif", fontSize: 26, fontWeight: 700, color: C.white, marginBottom: 4 }}>
            <span style={{ color: C.amber }}>Park</span>Share
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)" }}>
            {screen === "landing" && "Welcome — sign in or create an account"}
            {screen === "signin" && "Welcome back!"}
            {screen === "signup" && "Create your free account"}
            {screen === "role" && "How will you use ParkShare?"}
            {screen === "disclaimer" && "Before you continue"}
          </div>
          {screen !== "landing" && screen !== "role" && (
            <button onClick={() => { setScreen(screen === "disclaimer" ? "role" : "landing"); setErrors({}); }} style={{ position: "absolute", top: 14, left: 14, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", color: C.white, fontSize: 15 }}>←</button>
          )}
          {screen !== "role" && screen !== "disclaimer" && (
            <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", color: C.white, fontSize: 17 }}>×</button>
          )}
        </div>

        <div style={{ padding: "22px 24px 26px" }}>

          {/* Landing */}
          {screen === "landing" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 2 }}>
                <img src={PARKER.welcome} alt="Parker waving hello" style={{ height: 92, width: "auto" }} />
              </div>
              <button onClick={() => setScreen("signup")} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 12, padding: 14, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Create free account</button>
              <button onClick={() => setScreen("signin")} style={{ background: "transparent", color: C.navy, border: "2px solid "+C.concrete, borderRadius: 12, padding: 13, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Sign in</button>
              <div style={{ textAlign: "center", fontSize: 12, color: C.muted, marginTop: 4 }}>Join 12,000+ drivers and hosts</div>
            </div>
          )}

          {/* Sign in */}
          {screen === "signin" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={lS}>Email</label><input style={iS(errors.email)} type="email" placeholder="you@example.com" value={form.email} onChange={e => upd("email", e.target.value)} />{errors.email && <div style={{ color: C.red, fontSize: 11, marginTop: 3 }}>{errors.email}</div>}</div>
              <div><label style={lS}>Password</label><input style={iS(errors.password)} type="password" placeholder="Your password" value={form.password} onChange={e => upd("password", e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />{errors.password && <div style={{ color: C.red, fontSize: 11, marginTop: 3 }}>{errors.password}</div>}</div>
              {authError && <div style={{ color: C.red, fontSize: 12, textAlign: "center" }}>{authError}</div>}
              <button onClick={submit} disabled={loading} style={{ background: loading ? C.concrete : C.navy, color: loading ? C.muted : C.white, border: "none", borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 700, cursor: loading ? "default" : "pointer", marginTop: 4 }}>{loading ? "Signing in…" : "Sign in"}</button>
              <div style={{ textAlign: "center", fontSize: 12, color: C.muted }}>No account? <button onClick={() => { setScreen("signup"); setErrors({}); }} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Sign up free</button></div>
            </div>
          )}

          {/* Sign up */}
          {screen === "signup" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div><label style={lS}>Full name</label><input style={iS(errors.name)} placeholder="Jane Smith" value={form.name} onChange={e => upd("name", e.target.value)} />{errors.name && <div style={{ color: C.red, fontSize: 11, marginTop: 3 }}>{errors.name}</div>}</div>
              <div><label style={lS}>Email</label><input style={iS(errors.email)} type="email" placeholder="you@example.com" value={form.email} onChange={e => upd("email", e.target.value)} />{errors.email && <div style={{ color: C.red, fontSize: 11, marginTop: 3 }}>{errors.email}</div>}</div>
              <div><label style={lS}>Password</label><input style={iS(errors.password)} type="password" placeholder="At least 6 characters" value={form.password} onChange={e => upd("password", e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />{errors.password && <div style={{ color: C.red, fontSize: 11, marginTop: 3 }}>{errors.password}</div>}</div>
              {authError && <div style={{ color: C.red, fontSize: 12, textAlign: "center" }}>{authError}</div>}
              <button onClick={submit} disabled={loading} style={{ background: loading ? C.concrete : C.amber, color: loading ? C.muted : C.navy, border: "none", borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 700, cursor: loading ? "default" : "pointer", marginTop: 4 }}>{loading ? "Creating account…" : "Create account →"}</button>
              <div style={{ textAlign: "center", fontSize: 12, color: C.muted }}>Already have an account? <button onClick={() => { setScreen("signin"); setErrors({}); }} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>Sign in</button></div>
            </div>
          )}

          {/* Role picker */}
          {screen === "role" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ textAlign: "center", fontSize: 14, color: C.navy, fontWeight: 600, marginBottom: 6 }}>
                Hi {pendingUser?.name}! What would you like to do?
              </div>
              {[
                { role: "driver", icon: "🚗", title: "Find a driveway", sub: "Browse and book private driveways near you by the hour" },
                { role: "host", icon: "🏠", title: "List my driveway", sub: "Earn money renting out your empty driveway to drivers" },
              ].map(r => (
                <button key={r.role} onClick={() => pickRole(r.role)} style={{ background: C.white, border: "2px solid "+C.concrete, borderRadius: 16, padding: "16px 14px", cursor: "pointer", textAlign: "left", display: "flex", gap: 14, alignItems: "center" }}>
                  <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg, "+C.navy+", #33465A)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, flexShrink: 0 }}>{r.icon}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: C.navy, marginBottom: 3 }}>{r.title}</div>
                    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{r.sub}</div>
                  </div>
                  <div style={{ marginLeft: "auto", fontSize: 18, color: C.muted }}>›</div>
                </button>
              ))}
              <div style={{ textAlign: "center", fontSize: 11, color: C.muted, marginTop: 4 }}>You can switch roles anytime in settings</div>
            </div>
          )}

          {/* Liability disclaimer — required before finalizing signup */}
          {screen === "disclaimer" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: C.navy }}>Disclaimer of Liability</div>
              <div style={{ background: C.warmWhite, border: "1.5px solid "+C.concrete, borderRadius: 12, padding: "14px 16px", maxHeight: 220, overflowY: "auto", fontSize: 12.5, color: C.navy, lineHeight: 1.6 }}>
                <p style={{ margin: "0 0 10px" }}>
                  ParkShare is a booking platform, not an insurer or property manager. We connect driveway owners ("Hosts") with drivers ("Renters") and are not a party to the parking arrangement between you.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Renters</strong> are responsible for their vehicle while parked, including any damage, theft, towing, or fines — even through no fault of their own.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Hosts</strong> are responsible for their property and for accurately describing their listing.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  ParkShare is not liable for damage, injury, disputes, or losses connected to a booking, to the fullest extent the law allows.
                </p>
                <p style={{ margin: 0 }}>
                  This is a summary. <a href="https://myparkshare.ca/legal.html#liability" target="_blank" rel="noopener noreferrer" style={{ color: C.navy, fontWeight: 700 }}>Read the full Disclaimer of Liability →</a>
                </p>
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 2, width: 18, height: 18, flexShrink: 0, accentColor: C.navy, cursor: "pointer" }} />
                <span style={{ fontSize: 12.5, color: C.navy, lineHeight: 1.5 }}>
                  I have read and agree to this Disclaimer of Liability, including that all risk of damage and any towing or impound costs are my responsibility as the Renter.
                </span>
              </label>
              {authError && <div style={{ color: C.red, fontSize: 12, textAlign: "center" }}>{authError}</div>}
              <button onClick={finalizeSignup} disabled={!agreed || loading} style={{ background: agreed ? C.amber : C.concrete, color: agreed ? C.navy : C.muted, border: "none", borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 700, cursor: agreed && !loading ? "pointer" : "not-allowed" }}>{loading ? "Creating account…" : "I Agree & Create Account"}</button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
// ─── Floating Parker Help Assistant ────────────────────────────────────────────
const HELP_TOPICS = [
  { q: "How do I book a driveway?", a: "Browse listings or search by address, pick a spot, choose your hours, and pay securely — you'll get directions and any gate codes right in your confirmation." },
  { q: "How do I list my driveway?", a: "Tap \"List Your Driveway,\" add photos, set your hourly price and availability, and you're live. Most hosts get their first booking within a few days!" },
  { q: "How do payments work?", a: "You're only charged when a booking is confirmed. Hosts get paid out automatically after each completed booking, minus ParkShare's small service fee." },
  { q: "How do I contact a host?", a: "Open any listing and tap \"Message host\" — or find the conversation anytime under the Messages tab." },
  { q: "Can I cancel a booking?", a: "Yes — head to My Bookings and select the booking you'd like to cancel. Refund timing depends on how close you are to the start time." },
];

function FloatingParkerHelp() {
  const [open, setOpen] = useState(false);
  const [activeQ, setActiveQ] = useState(null);
  const [pos, setPos] = useState(null); // { right, bottom } in px; null = default corner
  const dragState = useRef({ dragging: false, moved: false, startX: 0, startY: 0, startRight: 16, startBottom: 16 });

  const BTN_SIZE = 60;

  const clampPos = (right, bottom) => {
    const maxRight = window.innerWidth - BTN_SIZE;
    const maxBottom = window.innerHeight - BTN_SIZE;
    return { right: Math.min(Math.max(right, 0), maxRight), bottom: Math.min(Math.max(bottom, 0), maxBottom) };
  };

  const onPointerDown = (e) => {
    const current = pos || { right: 16, bottom: 16 };
    dragState.current = {
      dragging: true, moved: false,
      startX: e.clientX, startY: e.clientY,
      startRight: current.right, startBottom: current.bottom,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragState.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    if (d.moved) {
      setPos(clampPos(d.startRight - dx, d.startBottom - dy));
    }
  };

  const onPointerUp = () => {
    dragState.current.dragging = false;
  };

  const handleClick = () => {
    if (dragState.current.moved) { dragState.current.moved = false; return; }
    setOpen(o => !o);
  };

  const corner = pos || { right: 16, bottom: 16 };
  const panelOnLeft = corner.right > (typeof window !== "undefined" ? window.innerWidth - 340 : 340);

  return (
    <div style={{ position: "fixed", right: corner.right, bottom: corner.bottom, zIndex: 1500, fontFamily: "'Poppins', sans-serif" }}>
      {open && (
        <div style={{ width: 300, maxWidth: "calc(100vw - 32px)", maxHeight: "70vh", overflowY: "auto", background: C.white, borderRadius: 18, boxShadow: "0 16px 48px rgba(0,0,0,0.25)", marginBottom: 12, border: "2px solid " + C.navy, marginLeft: panelOnLeft ? 0 : "auto", marginRight: panelOnLeft ? "auto" : 0 }}>
          <div style={{ background: "linear-gradient(135deg, " + C.navy + ", #33465A)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 10, borderRadius: "16px 16px 0 0" }}>
            <div style={{ width: 52, height: 64, borderRadius: "50%", background: C.white, overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid " + C.amber }}>
              <img src={PARKER.thinking} alt="Parker" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 25%" }} />
            </div>
            <div>
              <div style={{ color: C.white, fontWeight: 700, fontSize: 14 }}>Ask Parker</div>
              <div style={{ color: "rgba(255,255,255,0.65)", fontSize: 11 }}>Your ParkShare helper</div>
            </div>
            <button onClick={() => { setOpen(false); setActiveQ(null); }} style={{ marginLeft: "auto", background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%", width: 26, height: 26, cursor: "pointer", color: C.white, fontSize: 14, flexShrink: 0 }}>×</button>
          </div>

          <div style={{ padding: "14px 16px" }}>
            {activeQ === null ? (
              <>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>Hi, I'm Parker! What can I help with?</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {HELP_TOPICS.map((t, i) => (
                    <button key={i} onClick={() => setActiveQ(i)} style={{ textAlign: "left", background: C.warmWhite, border: "1.5px solid " + C.concrete, borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: C.navy, fontWeight: 600, cursor: "pointer" }}>
                      {t.q}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div>
                <button onClick={() => setActiveQ(null)} style={{ background: "none", border: "none", color: C.muted, fontSize: 11, cursor: "pointer", padding: 0, marginBottom: 10 }}>← Back to topics</button>
                <div style={{ fontWeight: 700, color: C.navy, fontSize: 13, marginBottom: 8 }}>{HELP_TOPICS[activeQ].q}</div>
                <div style={{ background: C.mossLight, border: "1px solid " + C.moss, borderRadius: 10, padding: "12px 14px", color: C.navy, fontSize: 13, lineHeight: 1.5 }}>
                  {HELP_TOPICS[activeQ].a}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleClick}
        style={{
          width: BTN_SIZE, height: BTN_SIZE, borderRadius: "50%", background: C.amber, border: "3px solid " + C.white,
          boxShadow: "0 6px 20px rgba(0,0,0,0.3), 0 0 0 2px " + C.navy, cursor: "grab",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 0, overflow: "hidden",
          marginLeft: "auto", touchAction: "none", userSelect: "none",
        }} aria-label="ParkShare help">
        <img src={PARKER.icon} alt="Parker help" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
      </button>
    </div>
  );
}

// ─── Footer — Contact Us / Legal & T&C, same size/design as the header buttons,
// left/right aligned to mirror Sign in / Join free above ─────────────────────
function Footer({ onLegalClick, onContactClick, onTrustClick, onAboutClick, onHelpClick }) {
  const btnStyle = { background: C.amber, color: C.navy, border: "2px solid " + C.navy, boxShadow: "0 0 0 2px " + C.white, borderRadius: 8, minWidth: 70, height: 38, padding: "0 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" };
  return (
    <footer className="ps-footer" style={{ background: C.navy, fontFamily: "'Poppins', sans-serif", padding: "14px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
        <button style={btnStyle} onClick={onAboutClick}>About Us</button>
        <button style={btnStyle} onClick={onHelpClick}>Help</button>
        <button style={btnStyle} onClick={onContactClick}>Contact Us</button>
        <button style={btnStyle} onClick={onTrustClick}>Trust &amp; Safety</button>
        <button style={btnStyle} onClick={onLegalClick}>Legal &amp; T/C</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <span style={{ color: C.white, fontSize: 10, fontWeight: 600, letterSpacing: 0.3 }}>Powered by</span>
        <img src={ESKA_LOGO} alt="Eska Technologies" style={{ height: 22, width: "auto" }} />
      </div>
    </footer>
  );
}

function Header({ tab, onTabChange, onLogoClick, user, onShowAuth, onSignOut, onHostClick, onAboutClick, onTrustClick, onHelpClick }) {
  const tabs = user?.role === "host"
    ? ["Browse", "Host Dashboard", "List Your Driveway", "Messages", "My Bookings", "Transactions"]
    : ["Browse", "My Bookings", "Messages", "List Your Driveway", "Host Dashboard", "Transactions"];

  return (
    <header className="ps-header" style={{ background: C.navy, fontFamily: "'Poppins', sans-serif", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 2px 10px rgba(0,0,0,0.2)" }}>
      {/* Top row: logo + user */}
      <div className="ps-header-row ps-mobile-header-row" style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "10px 16px", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          {!user && <button onClick={onShowAuth} style={{ background: C.amber, color: C.navy, border: "2px solid "+C.navy, boxShadow: "0 0 0 2px " + C.white, borderRadius: 8, width: 70, height: 38, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>Sign in</button>}
        </div>
        <button onClick={onLogoClick} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, justifySelf: "center" }}>
          <div style={{ display: "inline-block", textAlign: "center" }}>
            <div style={{ display: "inline-flex", alignItems: "center" }}>
              <div style={{ width: 62, height: 62, borderRadius: "50%", background: C.amber, border: "3px solid " + C.white, boxShadow: "0 0 0 2px " + C.navy, overflow: "hidden", flexShrink: 0, zIndex: 2, position: "relative" }}>
                <img src={PARKER.icon} alt="Parker" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div style={{ display: "inline-flex", flexDirection: "column", justifyContent: "center", background: C.amber, border: "2px solid " + C.navy, boxShadow: "0 0 0 2px " + C.white, borderRadius: 9, padding: "5px 14px 4px 22px", marginLeft: -18 }}>
                <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 19, color: C.navy, lineHeight: 1 }}>Park<span style={{ color: C.white }}>Share</span></span>
                <div style={{ height: 1.5, background: C.navy, opacity: 0.6, marginTop: 3 }} />
              </div>
            </div>
          </div>
        </button>
        {user ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.white }}>{user.name}</div>
              <div style={{ fontSize: 10, color: C.amber, fontWeight: 600 }}>{user.role === "host" ? "🏠 Host" : "🚗 Driver"}</div>
            </div>
            <button onClick={onSignOut} style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "4px 10px", fontSize: 11, color: "rgba(255,255,255,0.7)", cursor: "pointer" }}>Sign out</button>
          </div>
        ) : (
          <div style={{ display: "flex", justifySelf: "end" }}>
            <button onClick={onShowAuth} style={{ background: C.amber, color: C.navy, border: "2px solid "+C.navy, boxShadow: "0 0 0 2px " + C.white, borderRadius: 8, width: 70, height: 38, fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>Join free</button>
          </div>
        )}
      </div>
      {!user && (onHostClick || onAboutClick || onTrustClick || onHelpClick) && (
        <div className="ps-desktop-guest-header">
          <button className="ps-desktop-logo" onClick={onLogoClick} aria-label="ParkShare home">
            <div className="ps-desktop-logo-icon"><img src={PARKER.icon} alt="" /></div>
            <div className="ps-desktop-logo-wordmark">Park<span>Share</span></div>
          </button>
          <nav className="ps-desktop-guest-nav" aria-label="Primary navigation">
            <button onClick={() => onTabChange("Browse")}>Find Parking</button>
            {onHostClick && <button onClick={onHostClick}>Become a Host</button>}
            {onAboutClick && <button onClick={onAboutClick}>About</button>}
            {onTrustClick && <button onClick={onTrustClick}>Trust &amp; Safety</button>}
            {onHelpClick && <button onClick={onHelpClick}>Help</button>}
          </nav>
          <div className="ps-desktop-auth-actions">
            <button className="ps-desktop-signin" onClick={onShowAuth}>Sign in</button>
            <button className="ps-desktop-join" onClick={onShowAuth}>Join free</button>
          </div>
        </div>
      )}
      {/* Nav tabs — only shown once signed in; guests reach Browse via the landing page actions instead */}
      {user && (
        <div style={{ display: "flex", overflowX: "auto", gap: 6, padding: "0 12px 10px", scrollbarWidth: "none" }}>
          {tabs.map(t => (
            <button key={t} onClick={() => onTabChange(t)} style={{ flexShrink: 0, background: tab === t ? C.amber : "transparent", color: tab === t ? C.navy : "rgba(255,255,255,0.8)", border: "2px solid " + (tab === t ? C.white : "rgba(255,255,255,0.35)"), borderRadius: 20, padding: "5px 13px", fontSize: 11, fontWeight: tab === t ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap" }}>{t}</button>
          ))}
        </div>
      )}
      {/* Lane-line divider */}
      <div style={{ borderTop: "3px solid " + C.amber, opacity: 0.55 }} />
    </header>
  );
}

// ─── Landing Page — the first thing people see ─────────────────────────────────
// Single composite hero image (Parker + welcome text + both bars + trust bar,
// exactly as approved) embedded directly — no separate file uploads, ever.
// Two invisible buttons sit on top, positioned by percentage so they track
// the "Search an address" and "Use my current location" bars at any screen size.
// ─── Landing Page — the first thing people see ─────────────────────────────────
// Split into two images: brand/welcome on top, action buttons below.
// Bottom image still has the two invisible clickable overlays positioned by %.
const LANDING_BRAND = "/parker/parker-landing-brand.jpeg";
const LANDING_ACTION = "/parker/parker-landing-action.jpeg";

// A genuinely interactive "wow" moment: a live earnings calculator, rather
// than a static number or (worse) fabricated demand data. Uses the same
// $12/hr baseline and ~15-day/month fill assumption used elsewhere in the
// app's own earnings estimates, so the numbers stay internally consistent.
function EarningsCalculator() {
  const [hours, setHours] = useState(3);
  const [demand, setDemand] = useState(false);
  const RATE = 12, FILL_DAYS = 15, DEMAND_MULTIPLIER = 1.35;
  const monthly = Math.round(hours * RATE * FILL_DAYS * (demand ? DEMAND_MULTIPLIER : 1));
  const annual = monthly * 12;

  return (
    <div style={{ background: C.navy, borderRadius: 18, padding: "22px 20px", textAlign: "center" }}>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Try it yourself</div>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 15, color: C.white, marginBottom: 18 }}>How much could your driveway earn?</div>

      <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 36, color: C.amber, lineHeight: 1 }}>${annual.toLocaleString()}</div>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 3, marginBottom: 20 }}>estimated per year (${monthly.toLocaleString()}/mo)</div>

      <div style={{ textAlign: "left", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 12.5, color: "rgba(255,255,255,0.85)" }}>Hours available per day</span>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 12.5, color: C.amber }}>{hours} hr{hours !== 1 ? "s" : ""}</span>
        </div>
        <input
          type="range" min={1} max={12} step={1} value={hours}
          onChange={e => setHours(Number(e.target.value))}
          style={{ width: "100%", accentColor: C.amber, cursor: "pointer" }}
        />
      </div>

      <button
        onClick={() => setDemand(d => !d)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
          background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 10,
          padding: "10px 14px", cursor: "pointer", fontFamily: "'Poppins', sans-serif",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12.5, color: "rgba(255,255,255,0.85)", textAlign: "left" }}>Near a stadium, venue, or downtown core?</span>
        <span style={{
          width: 38, height: 22, borderRadius: 20, background: demand ? C.amber : "rgba(255,255,255,0.25)",
          position: "relative", flexShrink: 0, marginLeft: 10, transition: "background 0.15s",
        }}>
          <span style={{
            position: "absolute", top: 2, left: demand ? 18 : 2, width: 18, height: 18, borderRadius: "50%",
            background: C.white, transition: "left 0.15s",
          }} />
        </span>
      </button>

      <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 400, fontSize: 10, color: "rgba(255,255,255,0.55)", margin: "14px 0 0", lineHeight: 1.5 }}>
        Estimate only, based on a $12/hr average rate and ~15 booked days/month. Actual earnings vary.
      </p>
    </div>
  );
}

// Reusable so both the homepage teaser and the dedicated Host page show
// identical, non-duplicated earnings content.
function PotentialEarningsSection() {
  return (
    <div className="ps-earnings-section" style={{ maxWidth: 460, margin: "0 auto", padding: "26px 24px 6px" }}>
      <div className="ps-earnings-heading" style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 21, color: C.navy }}>💰 Potential Earnings</div>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 13, color: C.muted, marginTop: 2 }}>See what your driveway could make</div>
      </div>
      <div className="ps-earnings-layout">
        <div className="ps-earnings-calculator" style={{ marginBottom: 14 }}>
          <EarningsCalculator />
        </div>
        <div className="ps-earnings-scenarios" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { label: "2 hours/day", detail: "A couple hours after work or on weekends", low: 150, high: 300 },
          { label: "During work hours", detail: "9am–5pm on weekdays, while you're out", low: 300, high: 600 },
          { label: "Near a stadium or venue", detail: "Game days and events nearby", low: 400, high: 900 },
        ].map((row, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 14.5, color: C.navy }}>{row.label}</div>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 400, fontSize: 11.5, color: C.muted, marginTop: 1 }}>{row.detail}</div>
            </div>
            <div style={{ flexShrink: 0, textAlign: "right" }}>
              <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 16, color: C.navy, whiteSpace: "nowrap" }}>
                ${row.low}–${row.high}<span style={{ fontWeight: 600, fontSize: 10.5, color: C.muted }}>/mo</span>
              </div>
              <Badge color={C.moss}>est.</Badge>
            </div>
          </div>
        ))}
        </div>
      </div>
      <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 400, fontSize: 10.5, color: C.muted, textAlign: "center", margin: "12px 0 0", lineHeight: 1.5 }}>
        *Estimates only. Actual earnings vary by location, demand, and availability.
      </p>
    </div>
  );
}

function FoundingHostsCard({ onShowAuth }) {
  return (
    <div className="ps-founding-hosts" style={{ maxWidth: 460, margin: "0 auto", padding: "22px 24px 0" }}>
      <div style={{ background: C.navy, borderRadius: 16, padding: "20px 20px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Limited spots</div>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 20, color: C.white, lineHeight: 1.25, marginBottom: 6 }}>Join our Founding Hosts</div>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 13, color: "rgba(255,255,255,0.8)", lineHeight: 1.55, margin: "0 0 16px" }}>
          Be one of the first driveways on ParkShare and help shape the platform from day one.
        </p>
        <button onClick={onShowAuth} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 12, padding: "12px 26px", fontFamily: "'Poppins', sans-serif", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Become a Founding Host →</button>
      </div>
    </div>
  );
}

function LandingPage({ onSearchAddress, onUseLocation, tab, onTabChange, onLogoClick, user, onShowAuth, onSignOut, onLegalClick, onContactClick, onTrustClick, onHostClick, onDriverClick, onAboutClick, onHelpClick }) {
  const allListings = useAllListings();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSug, setLoadingSug] = useState(false);
  const [sugError, setSugError] = useState(false);
  const debounceRef = useRef(null);

  // Same geocoder + local-listing fallback BrowseView uses, so results are
  // identical whether someone searches here or on the map screen.
  const localFallbackSuggestions = (val) => {
    const q = val.toLowerCase();
    return allListings
      .filter(l => l.address.toLowerCase().includes(q) || l.title.toLowerCase().includes(q))
      .slice(0, 5)
      .map(l => ({ short: l.address, full: l.title + " — " + l.address, lat: l.lat, lng: l.lng }));
  };

  const handleSearch = (val) => {
    setQuery(val);
    setSuggestions([]);
    setSugError(false);
    clearTimeout(debounceRef.current);
    if (val.length < 2) { setLoadingSug(false); return; }
    setLoadingSug(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=" + encodeURIComponent(val), { headers: { "Accept-Language": "en" } });
        if (!res.ok) throw new Error("Geocoder returned " + res.status);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Unexpected response shape");
        const results = data.map(d => ({
          short: [d.address.house_number, d.address.road, d.address.city || d.address.town || d.address.suburb, d.address.state].filter(Boolean).join(", "),
          full: d.display_name,
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
        }));
        if (results.length === 0) {
          setSuggestions(localFallbackSuggestions(val));
        } else {
          setSuggestions(results);
        }
      } catch (e) {
        setSugError(true);
        setSuggestions(localFallbackSuggestions(val));
      }
      setLoadingSug(false);
    }, 350);
  };

  // Picking a suggestion here carries the exact address straight into the
  // Browse map — same lat/lng BrowseView would use if picked there directly.
  const pickSuggestion = (s) => {
    setQuery(s.short);
    setSuggestions([]);
    onSearchAddress(s);
  };

  const handleSubmit = () => {
    if (suggestions.length > 0) {
      pickSuggestion(suggestions[0]);
    } else {
      onSearchAddress(null, query);
    }
  };

  return (
    <div className="ps-landing-page" style={{ minHeight: "100vh", background: C.warmWhite, fontFamily: "'Poppins', sans-serif" }}>
      <style>{`
        .ps-hit { transition: background 0.1s ease; }
        .ps-hit:active { background: rgba(28,43,57,0.06); }
      `}</style>

      {/* Shared header — same one used everywhere else in the app */}
      <Header tab={tab} onTabChange={onTabChange} onLogoClick={onLogoClick} user={user} onShowAuth={onShowAuth} onSignOut={onSignOut} onHostClick={onHostClick} onAboutClick={onAboutClick} onTrustClick={onTrustClick} onHelpClick={onHelpClick} />

      <div className="ps-landing-hero-grid">
      {/* Vision statement — leads directly with the value proposition and
          a one-line positioning statement, rather than building up through
          the problem first. */}
      <div className="ps-landing-vision" style={{ maxWidth: 460, margin: "0 auto", background: C.navy, padding: "40px 28px 34px", textAlign: "center" }}>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 26, color: C.white, lineHeight: 1.25, margin: "0 0 10px" }}>
          Turn Empty Driveways Into <span style={{ color: C.amber }}>Opportunity</span>
        </p>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 15, color: "rgba(255,255,255,0.75)", lineHeight: 1.5, margin: 0 }}>
          Park<span style={{ color: C.amber }}>Share</span> is Canada's Driveway Rental Marketplace
        </p>
        <div className="ps-hero-ctas">
          <button onClick={onDriverClick} className="ps-hero-cta ps-hero-cta-primary">Find Parking →</button>
          <button onClick={onHostClick} className="ps-hero-cta ps-hero-cta-secondary">Become a Host →</button>
        </div>
      </div>

      {/* Top: brand / welcome hero — live text (not a baked image) so the
          title and subtitle always render in the actual Poppins font and
          exact brand colors, alongside Parker's mascot art. */}
      <div className="ps-landing-welcome" style={{ maxWidth: 460, margin: "0 auto", background: C.amber, padding: "28px 24px 20px", textAlign: "center" }}>
        <img src={PARKER.homeWave} alt="Parker, ParkShare's mascot, holding a phone with the ParkShare app" style={{ height: 173, width: "auto", display: "block", margin: "0 auto 10px" }} />
        <h1 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 15, color: C.navy, margin: "0 0 2px" }}>Welcome to</h1>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 34, color: C.navy, lineHeight: 1.1, margin: "0 0 8px" }}>Park<span style={{ color: C.white }}>Share</span></div>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 14, color: C.navy, margin: 0 }}>
          Let <span style={{ fontStyle: "italic", color: C.white }}>Parker</span> find you great parking anywhere!
        </p>
      </div>
      </div>

      {/* Audience split — routes visitors to a dedicated page for their
          situation immediately, instead of making both hosts and drivers
          read through the same generic homepage. The host card leads with
          the value proposition ("turn income into...") since "find parking"
          is self-explanatory but the host opportunity needs more selling —
          and both cards end in an explicit, equally weighted action label
          so neither path requires guessing what happens next. */}
      <div className="ps-two-ways-section" style={{ maxWidth: 460, margin: "0 auto", padding: "22px 24px 0" }}>
        <div style={{ textAlign: "center", fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 12.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
          Two ways to ParkShare
        </div>
        <div className="ps-two-ways-grid" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            onClick={onHostClick}
            className="ps-audience-card"
            style={{ textAlign: "left", width: "100%", background: C.amber, border: "3px solid " + C.navy, borderRadius: 18, padding: "20px 20px", boxShadow: "0 3px 12px rgba(14,27,46,0.15)", cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, flexShrink: 0 }}>🏠</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 10.5, color: C.navy, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, opacity: 0.7 }}>For hosts</div>
                <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 19, color: C.navy, lineHeight: 1.2, marginBottom: 6 }}>Turn your empty driveway into income</div>
                <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 12.5, color: C.navy, lineHeight: 1.5, opacity: 0.85 }}>Your driveway sits empty while you're at work. What if it earned money instead?</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: C.navy, borderRadius: 10, padding: "11px 16px" }}>
              <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13.5, color: C.white }}>Become a Host</span>
              <span style={{ fontSize: 15, color: C.amber }}>→</span>
            </div>
          </button>

          <button
            onClick={onDriverClick}
            className="ps-audience-card"
            style={{ textAlign: "left", width: "100%", background: C.navy, border: "3px solid " + C.navy, borderRadius: 18, padding: "20px 20px", boxShadow: "0 3px 12px rgba(14,27,46,0.15)", cursor: "pointer" }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
              <div style={{ width: 46, height: 46, borderRadius: "50%", background: C.amber, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, flexShrink: 0 }}>🚗</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 10.5, color: C.amber, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>For drivers</div>
                <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 19, color: C.white, lineHeight: 1.2, marginBottom: 6 }}>Find parking with confidence</div>
                <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 12.5, color: "rgba(255,255,255,0.8)", lineHeight: 1.5 }}>Imagine arriving knowing your parking spot is waiting for you.</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: C.amber, borderRadius: 10, padding: "11px 16px" }}>
              <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13.5, color: C.navy }}>Find Parking</span>
              <span style={{ fontSize: 15, color: C.navy }}>→</span>
            </div>
          </button>
        </div>
      </div>

      {/* Potential Earnings — answers a homeowner's first question ("how much
          can I make?") immediately, with clearly-labeled estimates rather
          than a vague pitch. */}
      <PotentialEarningsSection />

      {/* Urgency — invites early hosts in without a business promise (like
          a commission rate) that hasn't actually been confirmed/decided. */}
      {!user && <FoundingHostsCard onShowAuth={onShowAuth} />}

      {/* Stories — makes the value concrete through two short, illustrative
          scenarios (one host, one driver) rather than another stat. Framed
          as "how people use ParkShare" rather than named testimonials,
          since these are illustrative examples, not verified reviews. */}
      <div className="ps-stories-section" style={{ maxWidth: 460, margin: "0 auto", padding: "26px 24px 6px" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 21, color: C.navy }}>How people use ParkShare</div>
        </div>
        <div className="ps-stories-grid" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.amber, color: C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 15, flexShrink: 0 }}>🏠</div>
            <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 13.5, color: C.navy, lineHeight: 1.6, margin: 0 }}>
              Sarah works downtown. Her driveway sat empty every weekday. Today it earns enough to cover her internet bill.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 14, padding: "16px 18px" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.navy, color: C.amber, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 15, flexShrink: 0 }}>🚗</div>
            <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 13.5, color: C.navy, lineHeight: 1.6, margin: 0 }}>
              David searched 20 minutes for parking every morning. Now he books the same driveway in advance.
            </p>
          </div>
        </div>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 400, fontSize: 10.5, color: C.muted, textAlign: "center", margin: "10px 0 0" }}>
          Illustrative examples, not verified customer reviews.
        </p>
      </div>

      {/* Parker as guide: a quick orientation nudge for people who aren't
          signed in yet (a reasonable proxy for "first time here"). */}
      {!user && (
        <div style={{ maxWidth: 460, margin: "0 auto", padding: "18px 24px 0" }}>
          <ParkerTip pose="icon" circle>
            First time here? I'll show you how ParkShare works. <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={onShowAuth}>Get started →</span>
          </ParkerTip>
        </div>
      )}

      {/* Real, live search bar — same autocomplete BrowseView uses, not a static image */}
      <div className="ps-home-search" style={{ maxWidth: 460, margin: "0 auto", padding: "16px 24px 0" }}>
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.white, border: "2px solid " + C.navy, borderRadius: 16, padding: "12px 14px", boxShadow: "0 2px 10px rgba(28,43,57,0.05)" }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.navy, color: C.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🔍</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                value={query}
                onChange={e => handleSearch(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
                placeholder="Search an address"
                style={{ border: "none", outline: "none", background: "transparent", width: "100%", fontWeight: 700, fontSize: 15, color: C.navy, fontFamily: "inherit", padding: 0 }}
              />
              <div style={{ fontSize: 11.5, color: C.muted }}>Find parking near any location</div>
            </div>
            {loadingSug && <span style={{ fontSize: 13, flexShrink: 0 }}>⏳</span>}
            <button onClick={handleSubmit} aria-label="Search" style={{ background: "none", border: "none", fontSize: 18, color: C.navy, cursor: "pointer", flexShrink: 0, padding: 0 }}>›</button>
          </div>

          {/* Autocomplete dropdown */}
          {suggestions.length === 0 && sugError && !loadingSug && query.length >= 2 && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 12, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", zIndex: 500, padding: "10px 14px", fontSize: 12, color: C.muted }}>
              Couldn't reach the address lookup service, and no nearby listings matched "{query}".
            </div>
          )}
          {suggestions.length > 0 && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 12, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", zIndex: 500, overflow: "hidden" }}>
              {sugError && (
                <div style={{ padding: "6px 14px", fontSize: 10.5, color: C.muted, background: C.warmWhite, borderBottom: "1px solid " + C.concrete }}>
                  Live address lookup unavailable — showing matches from nearby listings
                </div>
              )}
              {suggestions.map((s, i) => (
                <div key={i} onClick={() => pickSuggestion(s)}
                  style={{ padding: "10px 14px", borderBottom: i < suggestions.length - 1 ? "1px solid " + C.concrete : "none", cursor: "pointer", display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}>📍</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.navy, whiteSpace: "normal", wordBreak: "break-word" }}>{s.short}</div>
                    <div style={{ fontSize: 11, color: C.muted, whiteSpace: "normal", wordBreak: "break-word" }}>{s.full}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Use my current location — real button, same layout/size as the search bar above */}
      <div className="ps-current-location" style={{ maxWidth: 460, margin: "0 auto", padding: "12px 24px 0" }}>
        <button
          onClick={onUseLocation}
          className="ps-hit"
          style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", background: C.white, border: "2px solid " + C.amber, borderRadius: 16, padding: "12px 14px", boxShadow: "0 2px 10px rgba(28,43,57,0.05)", cursor: "pointer", textAlign: "left" }}
        >
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.amber, color: C.navy, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🎯</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: C.navy }}>Use my current location</div>
            <div style={{ fontSize: 11.5, color: C.muted }}>Find parking near you</div>
          </div>
          <span style={{ fontSize: 18, color: C.amber, flexShrink: 0 }}>›</span>
        </button>
      </div>

      {/* Keep the existing mobile trust artwork unchanged. Desktop uses
          launch-safe live text so we don't overclaim verification/reviews. */}
      <div className="ps-trust-mobile-image" style={{ maxWidth: 460, margin: "0 auto", padding: "12px 24px 0" }}>
        <img src={LANDING_ACTION} alt="ParkShare trust and access benefits" style={{ width: "100%", height: "auto", display: "block" }} />
      </div>
      <div className="ps-trust-signals" style={{ maxWidth: 460, margin: "0 auto", padding: "12px 24px 0" }}>
        <div className="ps-trust-signal">
          <div className="ps-trust-icon">🔒</div>
          <div><strong>Secure Payments</strong><span>Protected checkout</span></div>
        </div>
        <div className="ps-trust-signal">
          <div className="ps-trust-icon">⭐</div>
          <div><strong>Community Feedback</strong><span>Ratings & reviews</span></div>
        </div>
        <div className="ps-trust-signal">
          <div className="ps-trust-icon">🕒</div>
          <div><strong>Flexible Parking</strong><span>Park on your time</span></div>
        </div>
      </div>

      {/* Closing vision — bookends the opening vision statement, leaving
          visitors with an inspired last impression before the footer. */}
      <div style={{ maxWidth: 460, margin: "24px auto 0", background: C.navy, padding: "40px 28px" }}>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 16, color: "rgba(255,255,255,0.85)", lineHeight: 1.6, textAlign: "center", margin: "0 0 10px" }}>
          Every empty driveway has value.
        </p>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 500, fontSize: 16, color: "rgba(255,255,255,0.85)", lineHeight: 1.6, textAlign: "center", margin: "0 0 18px" }}>
          Every driver deserves an easier way to park.
        </p>
        <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 21, color: C.white, lineHeight: 1.35, textAlign: "center", margin: 0 }}>
          Together we're building <span style={{ color: C.amber }}>Canada's driveway marketplace.</span>
        </p>
      </div>

      <div style={{ marginTop: 0 }}>
        <Footer onLegalClick={onLegalClick} onContactClick={onContactClick} onTrustClick={onTrustClick} onAboutClick={onAboutClick} onHelpClick={onHelpClick} />
      </div>
    </div>
  );
}

// ─── Legal & Policies — Terms of Service, Privacy Policy, Payment Processing
// Agreement, and Disclaimer of Liability, all on one page. Uses the same
// Header/Footer as the rest of the app so it reads as part of the site,
// not a bolted-on document. Reached via the footer's "Legal & T/C" button.
// ─────────────────────────────────────────────────────────────────────────────
function LegalDoc({ eyebrow, title, accent, updated, children }) {
  return (
    <section style={{ marginBottom: 56, scrollMarginTop: 90 }}>
      <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>{eyebrow}</div>
      <div style={{ display: "inline-block", background: C.amber, color: C.navy, border: "2px solid " + C.navy, boxShadow: "0 0 0 2px " + C.white, borderRadius: 10, padding: "8px 18px", marginBottom: 4 }}>
        <h1 style={{ fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 24, margin: 0, lineHeight: 1.2 }}>{title} <span style={{ color: C.white }}>{accent}</span></h1>
      </div>
      <p style={{ color: C.muted, fontSize: 12.5, margin: "10px 0 20px" }}>Last updated: {updated}</p>
      {children}
    </section>
  );
}

function LegalH2({ children }) {
  return <h2 style={{ color: C.navy, fontSize: 16, margin: "24px 0 8px", fontFamily: "'Poppins', sans-serif" }}>{children}</h2>;
}
function LegalP({ children }) {
  return <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "#333", margin: "0 0 10px" }}>{children}</p>;
}
function LegalUl({ items }) {
  return (
    <ul style={{ fontSize: 13.5, lineHeight: 1.7, color: "#333", margin: "0 0 10px", paddingLeft: 20 }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: 4 }}>{it}</li>)}
    </ul>
  );
}
function LegalLink({ href, children }) {
  return <a href={href} style={{ color: C.moss, textDecoration: "underline" }}>{children}</a>;
}
function LegalCallout({ children }) {
  return <div style={{ background: C.mossLight, borderLeft: "3px solid " + C.moss, padding: "10px 14px", borderRadius: 6, fontSize: 13, color: C.navy, margin: "10px 0" }}>{children}</div>;
}

function LegalPage({ tab, onTabChange, onLogoClick, user, onShowAuth, onSignOut, onContactClick, onTrustClick, onAboutClick, onHelpClick }) {
  const UPDATED = "July 18, 2026";
  const nav = [
    ["terms", "Terms of Service"],
    ["privacy", "Privacy Policy"],
    ["payments", "Payment Processing"],
    ["liability", "Liability Disclaimer"],
  ];
  return (
    <div style={{ minHeight: "100vh", background: C.warmWhite }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');`}</style>
      <Header tab={tab} onTabChange={onTabChange} onLogoClick={onLogoClick} user={user} onShowAuth={onShowAuth} onSignOut={onSignOut} />

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px 60px", fontFamily: "'Poppins', sans-serif" }}>
        <div style={{ background: C.white, border: "2px solid " + C.navy, boxShadow: "0 0 0 2px " + C.white + ", 0 2px 10px rgba(28,43,57,0.08)", borderRadius: 14, padding: "18px 20px", marginBottom: 32 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted, fontWeight: 700, marginBottom: 10 }}>On this page</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {nav.map(([id, label]) => (
              <a key={id} href={"#" + id} style={{ color: C.navy, textDecoration: "none", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.hazard, flexShrink: 0 }} />
                {label}
              </a>
            ))}
          </div>
        </div>

        <div id="terms">
          <LegalDoc eyebrow="Legal document 1 of 4" title="Terms of" accent="Service" updated={UPDATED}>
            <LegalH2>1. Agreement to Terms</LegalH2>
            <LegalP>These Terms of Service ("Terms") govern your access to and use of the ParkShare website, mobile application, and related services (collectively, the "Platform"), operated by ESKA Technologies Inc. ("ParkShare," "we," "us," or "our"). By creating an account, browsing listings, booking a parking space, or listing your driveway, you agree to be bound by these Terms.</LegalP>
            <LegalP>If you do not agree to these Terms, do not use the Platform.</LegalP>

            <LegalH2>2. What ParkShare Is</LegalH2>
            <LegalP>ParkShare is a marketplace that connects individuals who own or control private driveways and parking spaces ("Hosts") with individuals seeking to rent parking ("Renters"). ParkShare does not own, operate, inspect, or manage any parking space listed on the Platform. ParkShare is not a party to the parking arrangement formed between a Host and a Renter — we merely provide the platform, booking tools, and payment facilitation.</LegalP>

            <LegalH2>3. Eligibility and Accounts</LegalH2>
            <LegalUl items={[
              "You must be at least 18 years old (or the age of majority in your jurisdiction) to create an account.",
              "You agree to provide accurate, current, and complete information when registering, and to keep it updated.",
              "You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account.",
              "We may suspend or terminate accounts that violate these Terms, provide false information, or engage in fraudulent or harmful conduct.",
            ]} />

            <LegalH2>4. Host Responsibilities</LegalH2>
            <LegalP>If you list a driveway or parking space as a Host, you represent and warrant that:</LegalP>
            <LegalUl items={[
              "You own the property or have express legal authority (e.g., as a tenant, with landlord permission) to offer the space for parking.",
              "The listing accurately describes the space, its dimensions, access restrictions, availability windows, and features.",
              "You will honor confirmed bookings and provide the access described in your listing in a timely manner.",
              "You are responsible for ensuring the space is reasonably safe and free of hazards you are aware of.",
              "You are solely responsible for any tax obligations, permits, HOA/condo restrictions, insurance requirements, or municipal bylaws applicable to renting out your driveway.",
            ]} />

            <LegalH2>5. Renter Responsibilities</LegalH2>
            <LegalUl items={[
              "You will park only in the exact space you booked, for the exact time window booked, and will vacate promptly at the end of your booking.",
              "You assume full responsibility for your vehicle while it is parked at a Host's location, including risk of damage, theft, or towing resulting from your own actions or violation of the Host's posted instructions.",
              "You will not cause damage to the Host's property, and you agree to reimburse the Host for any damage you cause.",
              "Failure to vacate on time may result in additional charges, towing at your expense, or account suspension.",
            ]} />

            <LegalH2>6. Bookings, Payments, and Fees</LegalH2>
            <LegalP>All bookings are paid for through the Platform via our third-party payment processor (Stripe). See the <LegalLink href="#payments">Payment Processing Agreement</LegalLink> for details. ParkShare charges a service fee on each booking, shown at checkout. Prices are set by Hosts, subject to any platform minimums or maximums we may establish. Payouts to Hosts are issued after a completed booking, subject to processing times determined by our payment processor.</LegalP>

            <LegalH2>7. Cancellations and Refunds</LegalH2>
            <LegalP>Renters may cancel a booking in accordance with the cancellation window shown at the time of booking. Refund eligibility depends on how close to the booking start time the cancellation occurs. Hosts who cancel a confirmed booking without cause may be subject to penalties, including reduced visibility on the Platform or account suspension. ParkShare reserves the right to issue refunds or credits at its discretion in cases of Platform error, fraud, or unresolved disputes.</LegalP>

            <LegalH2>8. Reviews</LegalH2>
            <LegalP>Reviews must be honest, based on an actual completed booking, and must not contain harassment, discriminatory content, or false statements. We reserve the right to remove reviews that violate this policy.</LegalP>

            <LegalH2>9. Prohibited Conduct</LegalH2>
            <LegalP>You agree not to:</LegalP>
            <LegalUl items={[
              "List a space you do not have the right to offer.",
              "Provide false information about a listing, vehicle, or identity.",
              "Use the Platform for any unlawful purpose.",
              "Circumvent ParkShare's payment system to avoid fees (e.g., arranging payment directly with a Host or Renter outside the Platform for a booking initiated on ParkShare).",
              "Harass, threaten, or discriminate against other users.",
              "Interfere with the security or proper functioning of the Platform.",
            ]} />

            <LegalH2>10. Limitation of Liability</LegalH2>
            <LegalP>To the maximum extent permitted by law, ParkShare shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Platform. See the <LegalLink href="#liability">Disclaimer of Liability</LegalLink> for full details.</LegalP>
            <LegalP>ParkShare's total aggregate liability to you for any claim arising from these Terms or your use of the Platform shall not exceed the greater of (a) the amount of fees you paid to ParkShare in the twelve (12) months preceding the claim, or (b) CAD $100.</LegalP>

            <LegalH2>11. Disclaimer of Warranties</LegalH2>
            <LegalP>The Platform is provided "as is" and "as available" without warranties of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not guarantee that listings are accurate, that the Platform will be uninterrupted or error-free, or that any particular parking space will be available.</LegalP>

            <LegalH2>12. Indemnification</LegalH2>
            <LegalP>You agree to indemnify and hold harmless ParkShare and its officers, employees, and agents from any claims, damages, losses, liabilities, and expenses (including legal fees) arising from your use of the Platform, your violation of these Terms, or your violation of any rights of a third party.</LegalP>

            <LegalH2>13. Dispute Resolution</LegalH2>
            <LegalP>Disputes between a Host and a Renter regarding a specific booking should first be addressed directly between the parties using the Platform's messaging feature. ParkShare may, but is not obligated to, assist in resolving disputes.</LegalP>
            <LegalP>Any dispute between you and ParkShare arising from these Terms shall be resolved through binding arbitration in Ontario, Canada, except where prohibited by law. You waive any right to participate in a class action.</LegalP>

            <LegalH2>14. Modifications to the Platform and Terms</LegalH2>
            <LegalP>We may modify, suspend, or discontinue any part of the Platform at any time. We may update these Terms from time to time; continued use of the Platform after changes take effect constitutes acceptance of the revised Terms.</LegalP>

            <LegalH2>15. Governing Law</LegalH2>
            <LegalP>These Terms are governed by the laws of Ontario, Canada, without regard to conflict of law principles.</LegalP>

            <LegalH2>16. Contact</LegalH2>
            <LegalP>Questions about these Terms: <LegalLink href="mailto:Support@myparkshare.ca">Support@myparkshare.ca</LegalLink></LegalP>
          </LegalDoc>
        </div>

        <div id="privacy">
          <LegalDoc eyebrow="Legal document 2 of 4" title="Privacy" accent="Policy" updated={UPDATED}>
            <LegalP>This Privacy Policy explains how ESKA Technologies Inc. ("ParkShare," "we," "us," or "our") collects, uses, shares, and protects your personal information when you use the ParkShare website and mobile application (the "Platform").</LegalP>

            <LegalH2>1. Information We Collect</LegalH2>
            <LegalP><strong>Information you provide:</strong> account details, listing info (Hosts), booking info (Renters), payment info (processed by Stripe), messages, reviews, and support requests.</LegalP>
            <LegalP><strong>Information collected automatically:</strong> location data (with your permission), usage data, and cookies.</LegalP>
            <LegalP><strong>From third parties:</strong> authentication data (Supabase), address/geocoding data (Google Maps / OpenStreetMap), and transaction metadata (Stripe).</LegalP>

            <LegalH2>2. How We Use Your Information</LegalH2>
            <LegalUl items={[
              "Create and manage your account, display listings, and process bookings.",
              "Facilitate payments and payouts.",
              "Enable Host–Renter communication and send booking notifications.",
              "Verify Host identity and property ownership.",
              "Detect and prevent fraud and abuse.",
              "Improve the Platform and comply with legal obligations.",
            ]} />
            <LegalCallout>We do not sell your personal information to third parties.</LegalCallout>

            <LegalH2>3. How We Share Your Information</LegalH2>
            <LegalP><strong>Between Hosts and Renters:</strong> limited info (name, listing address, access instructions, messages) is shared to facilitate a booking.</LegalP>
            <LegalP><strong>Service providers:</strong> Stripe (payments), Supabase (authentication/database), Vercel (hosting), Google Maps / OpenStreetMap (mapping).</LegalP>
            <LegalP><strong>Legal requirements:</strong> we may disclose information if required by law or to protect rights, property, or safety.</LegalP>

            <LegalH2>4. Payment Information</LegalH2>
            <LegalP>All payment card information is collected and processed directly by <strong>Stripe</strong>. ParkShare does not store your full card number, expiry date, or CVV.</LegalP>

            <LegalH2>5. Data Retention</LegalH2>
            <LegalP>We retain your information for as long as your account is active or as needed to provide services and comply with legal obligations. You may request deletion at any time.</LegalP>

            <LegalH2>6. Data Security</LegalH2>
            <LegalP>We use encrypted data transmission (HTTPS) and secure authentication practices. No system is completely secure, and we cannot guarantee absolute security.</LegalP>

            <LegalH2>7. Your Rights and Choices</LegalH2>
            <LegalP>You may have the right to access, correct, or delete your personal information, and to withdraw consent for location tracking. Contact <LegalLink href="mailto:Support@myparkshare.ca">Support@myparkshare.ca</LegalLink> to exercise these rights.</LegalP>

            <LegalH2>8. Account Deletion</LegalH2>
            <LegalP>Request account deletion via <LegalLink href="mailto:Support@myparkshare.ca">Support@myparkshare.ca</LegalLink>. We will delete or anonymize your information within 90 days, except where retention is legally required.</LegalP>

            <LegalH2>9. Children's Privacy</LegalH2>
            <LegalP>The Platform is not intended for anyone under 18. We do not knowingly collect information from children. If we learn that we have collected information from a child under 18, we will delete it.</LegalP>

            <LegalH2>10. International Users</LegalH2>
            <LegalP>ParkShare is operated from Canada. Your information may be transferred to and processed in Canada or other jurisdictions where our service providers operate.</LegalP>

            <LegalH2>11. Changes to This Policy</LegalH2>
            <LegalP>We may update this Privacy Policy from time to time. Material changes will be reflected with a new "Last updated" date.</LegalP>

            <LegalH2>12. Contact Us</LegalH2>
            <LegalP>ESKA Technologies Inc.<br />Vaughan, Ontario<br /><LegalLink href="mailto:Support@myparkshare.ca">Support@myparkshare.ca</LegalLink></LegalP>
          </LegalDoc>
        </div>

        <div id="payments">
          <LegalDoc eyebrow="Legal document 3 of 4" title="Payment Processing" accent="Agreement" updated={UPDATED}>
            <LegalP>This Agreement explains how payments, fees, and payouts work on the ParkShare Platform, and forms part of the ParkShare <LegalLink href="#terms">Terms of Service</LegalLink>. By making a booking or listing a driveway on ParkShare, you agree to this Agreement.</LegalP>

            <LegalH2>1. Payment Processor</LegalH2>
            <LegalP>ParkShare uses <strong>Stripe, Inc.</strong> ("Stripe") to process all payments on the Platform. ParkShare is not a bank, and does not directly hold, transmit, or store your payment card details. All card data is collected and processed by Stripe in accordance with PCI-DSS security standards.</LegalP>
            <LegalP>By using ParkShare's payment features, you also agree to Stripe's <LegalLink href="https://stripe.com/connect-account/legal">Connected Account Agreement</LegalLink> and <LegalLink href="https://stripe.com/legal">Terms of Service</LegalLink>, as applicable.</LegalP>

            <LegalH2>2. How Charges Work (Renters)</LegalH2>
            <LegalP>Your total charge is calculated as (hourly rate × hours booked) + service fee, and charged in full via Stripe Checkout at booking confirmation. You'll receive a receipt via email. All charges are in CAD unless otherwise indicated.</LegalP>

            <LegalH2>3. Service Fees</LegalH2>
            <LegalP>ParkShare charges a service fee (currently displayed as a percentage at checkout, e.g., 15%) on each booking. The fee is disclosed before you confirm payment and is included in the total shown at checkout. Service fees are non-refundable except where a booking is cancelled or refunded per Section 5.</LegalP>

            <LegalH2>4. Payouts to Hosts</LegalH2>
            <LegalP>Hosts receive payouts for completed bookings, less the applicable ParkShare service fee, via Stripe. Hosts must complete Stripe's identity verification and connected account onboarding process before they can receive payouts. Payout timing follows Stripe's standard payout schedule and may vary based on your bank, region, and account verification status. ParkShare is not responsible for delays in payout caused by Stripe, your financial institution, or incomplete/inaccurate account information you provide.</LegalP>

            <LegalH2>5. Cancellations, Refunds, and Disputes</LegalH2>
            <LegalP>Refund eligibility for cancelled bookings is governed by the cancellation policy shown at the time of booking. Approved refunds are issued to the original payment method via Stripe and may take several business days to appear, depending on your bank. If a Renter disputes a charge directly with their bank or card issuer ("chargeback"), ParkShare and/or the Host may provide booking records to Stripe to contest the dispute. Hosts may have payouts withheld or reversed if a chargeback is upheld against a related booking. ParkShare reserves the right to investigate suspected fraudulent bookings and to withhold or reverse payouts pending investigation.</LegalP>

            <LegalH2>6. Taxes</LegalH2>
            <LegalP>Hosts are solely responsible for determining and remitting any taxes owed on income earned through ParkShare, including but not limited to income tax, HST/GST, or other applicable sales taxes. ParkShare does not provide tax advice. Hosts should consult a tax professional regarding their obligations. Where required by law, ParkShare or Stripe may issue tax reporting documents (e.g., 1099-K in the U.S., or equivalent) to Hosts who meet applicable reporting thresholds.</LegalP>

            <LegalH2>7. Currency and Exchange Rates</LegalH2>
            <LegalP>All prices on the Platform are listed in CAD. If your payment method is denominated in a different currency, your card issuer may apply currency conversion fees; ParkShare is not responsible for such fees.</LegalP>

            <LegalH2>8. Failed or Declined Payments</LegalH2>
            <LegalP>If a payment fails or is declined, your booking will not be confirmed until a successful payment is completed. ParkShare is not liable for any parking space becoming unavailable while you attempt to complete payment.</LegalP>

            <LegalH2>9. Security</LegalH2>
            <LegalP>Stripe employs industry-standard encryption and fraud-detection tools. Neither ParkShare nor Stripe can guarantee absolute security of any data transmission over the internet.</LegalP>

            <LegalH2>10. Changes to Fees</LegalH2>
            <LegalP>ParkShare may change its service fee structure at any time. Any fee changes will be reflected at checkout before you confirm a new booking and will not retroactively apply to bookings already completed.</LegalP>

            <LegalH2>11. Limitation of Liability</LegalH2>
            <LegalP>ParkShare's liability with respect to payment processing is limited as set out in the <LegalLink href="#terms">Terms of Service</LegalLink> and <LegalLink href="#liability">Liability Disclaimer</LegalLink>. ParkShare is not liable for errors, delays, or failures caused by Stripe, banking networks, or other third-party financial infrastructure outside our control.</LegalP>

            <LegalH2>12. Contact</LegalH2>
            <LegalP>Payment-related questions can be directed to <LegalLink href="mailto:Support@myparkshare.ca">Support@myparkshare.ca</LegalLink>.</LegalP>
          </LegalDoc>
        </div>

        <div id="liability">
          <LegalDoc eyebrow="Legal document 4 of 4" title="Disclaimer of" accent="Liability" updated={UPDATED}>
            <LegalP>This Disclaimer of Liability supplements the ParkShare <LegalLink href="#terms">Terms of Service</LegalLink> and applies to all use of the ParkShare Platform. By using ParkShare, you acknowledge and agree to the following.</LegalP>

            <LegalH2>1. ParkShare Is a Marketplace, Not a Party to Bookings</LegalH2>
            <LegalP>ParkShare is a technology platform that connects driveway owners ("Hosts") with drivers seeking parking ("Renters"). ParkShare does not own, inspect, maintain, or control any parking space listed on the Platform, and is not a party to the parking arrangement formed between a Host and a Renter.</LegalP>

            <LegalH2>2. Renter Assumption of Risk</LegalH2>
            <LegalP>By booking and parking a vehicle through ParkShare, the Renter assumes full responsibility for their vehicle while it is parked at a Host's location. This includes, without limitation:</LegalP>
            <LegalUl items={[
              "Any damage to the Renter's vehicle, however caused, while parked at the Host's property.",
              "Any damage the Renter's vehicle causes to the Host's property or to other property or vehicles.",
              "Any towing, impound, ticketing, or storage costs incurred as a result of the booking, improper parking, overstaying the booked time, or violation of a Host's posted instructions.",
              "Any theft or vandalism affecting the Renter's vehicle or its contents while parked.",
            ]} />
            <LegalP>ParkShare and the Host are not liable for any of the above.</LegalP>

            <LegalH2>3. Host Responsibility for Property</LegalH2>
            <LegalP>Hosts are solely responsible for:</LegalP>
            <LegalUl items={[
              "Accurately describing their space, access instructions, and any restrictions.",
              "Ensuring they have the legal right (as owner, tenant with permission, etc.) to offer the space for rent.",
              "Any hazards, defects, or conditions on their property, except as caused by a Renter's negligence or misconduct.",
              "Compliance with any applicable municipal bylaws, HOA/condo rules, insurance requirements, or lease terms related to renting out their driveway.",
            ]} />
            <LegalP>ParkShare does not inspect or certify the safety or legality of any listed space.</LegalP>

            <LegalH2>4. No Warranty on Listings</LegalH2>
            <LegalP>ParkShare does not guarantee the accuracy of any listing, including photos, described dimensions, features, or availability. Renters are encouraged to review listing details, photos, and reviews carefully, and to communicate with the Host before booking if they have questions.</LegalP>

            <LegalH2>5. Limitation of Liability</LegalH2>
            <LegalP>To the maximum extent permitted by applicable law, ParkShare, its officers, employees, contractors, and agents shall not be liable for:</LegalP>
            <LegalUl items={[
              "Any indirect, incidental, special, consequential, exemplary, or punitive damages;",
              "Any loss of use, data, profits, or goodwill;",
              "Any dispute, loss, damage, theft, towing fee, fine, personal injury, or property damage arising from or related to a booking, a Host, or a Renter,",
            ]} />
            <LegalP>whether based in contract, tort (including negligence), strict liability, or any other legal theory, even if ParkShare has been advised of the possibility of such damages.</LegalP>
            <LegalP>Where liability cannot be fully excluded under applicable law, ParkShare's total aggregate liability shall not exceed the greater of (a) the fees paid by the affected user to ParkShare in the twelve (12) months preceding the event giving rise to the claim, or (b) CAD $100.</LegalP>

            <LegalH2>6. Personal Injury</LegalH2>
            <LegalP>ParkShare's platform is limited to facilitating vehicle parking arrangements. Any personal injury occurring on a Host's property is a matter between the Host and the injured party, subject to applicable premises liability law in the relevant jurisdiction. ParkShare assumes no liability for personal injury occurring during a booking.</LegalP>

            <LegalH2>7. Indemnification</LegalH2>
            <LegalP>Users agree to indemnify and hold ParkShare harmless from any claims, losses, or damages, including reasonable legal fees, arising out of their use of the Platform, their breach of these terms, or their interactions with other users, to the fullest extent permitted by law.</LegalP>

            <LegalH2>8. Acknowledgment</LegalH2>
            <LegalP>By creating an account, listing a space, or booking a parking spot, you confirm that you have read, understood, and agree to this Disclaimer of Liability, and that all risk of damage, loss, towing, or injury connected to a booking is your responsibility as described above.</LegalP>

            <LegalH2>9. Contact</LegalH2>
            <LegalP>Questions about this Disclaimer can be directed to <LegalLink href="mailto:Support@myparkshare.ca">Support@myparkshare.ca</LegalLink>.</LegalP>
          </LegalDoc>
        </div>
      </div>

      <Footer onLegalClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); }} onContactClick={onContactClick} onTrustClick={onTrustClick} onAboutClick={onAboutClick} onHelpClick={onHelpClick} />
    </div>
  );
}

// ─── Contact Us — same Header/Footer, color scheme, and card layout as the
// Legal page, with a simple form. Reached via the footer's "Contact Us"
// button. Form has no backend wired up yet — see the TODO on handleSubmit.
// ─────────────────────────────────────────────────────────────────────────────
function ContactField({ label, name, value, onChange, type = "text", textarea, error }) {
  const fieldStyle = {
    width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 14,
    border: "2px solid " + (error ? C.hazard : C.concrete), fontFamily: "'Poppins', sans-serif",
    color: C.navy, background: C.white, outline: "none", boxSizing: "border-box",
  };
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 6 }}>{label}</label>
      {textarea ? (
        <textarea name={name} value={value} onChange={onChange} rows={5} style={{ ...fieldStyle, resize: "vertical" }} />
      ) : (
        <input type={type} name={name} value={value} onChange={onChange} style={fieldStyle} />
      )}
      {error && <div style={{ color: C.hazard, fontSize: 12, marginTop: 4, fontWeight: 600 }}>{error}</div>}
    </div>
  );
}

// ─── Trust & Safety — full policy-style page covering the community
// standards, listing accuracy, payments, reviews, respect, privacy, and
// pre-trip checklists for both Hosts and Drivers. Same pill-nav + section
// pattern as the About page, closing with the same Find Parking / Become a
// Host CTA pair used elsewhere.
// ─────────────────────────────────────────────────────────────────────────────
const TRUST_SECTIONS = [
  { id: "community", icon: "🤝", title: "Community" },
  { id: "listings", icon: "📋", title: "Listings" },
  { id: "payments", icon: "🔒", title: "Payments" },
  { id: "reviews", icon: "⭐", title: "Reviews" },
  { id: "respect", icon: "🏡", title: "Respect" },
  { id: "privacy", icon: "🛡️", title: "Privacy" },
  { id: "before-park", icon: "🚗", title: "Before You Park" },
  { id: "before-host", icon: "🏠", title: "Before You Host" },
  { id: "support", icon: "💬", title: "Support" },
];

function TrustPage({ tab, onTabChange, onLogoClick, user, onShowAuth, onSignOut, onLegalClick, onContactClick, onAboutClick, onHostClick, onDriverClick, onHelpClick }) {
  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const P = ({ children, style }) => (
    <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 12px", ...style }}>{children}</p>
  );
  const UL = ({ items, style }) => (
    <ul style={{ margin: "0 0 12px", paddingLeft: 20, ...style }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", marginBottom: 4 }}>{item}</li>
      ))}
    </ul>
  );
  return (
    <div style={{ minHeight: "100vh", background: C.warmWhite }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');`}</style>
      <Header tab={tab} onTabChange={onTabChange} onLogoClick={onLogoClick} user={user} onShowAuth={onShowAuth} onSignOut={onSignOut} />

      {/* On-page nav — same pill button style used throughout the app */}
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "20px 20px 0", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {TRUST_SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            style={{ background: C.amber, border: "2px solid " + C.white, boxShadow: "0 0 0 2px " + C.navy, color: C.navy, borderRadius: 20, fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11.5, padding: "7px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
          >
            <span>{s.icon}</span>{s.title}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 460, margin: "0 auto", padding: "20px 24px 0", fontFamily: "'Poppins', sans-serif" }}>

        {/* Intro */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Trust &amp; Safety</div>
          <h1 style={{ fontWeight: 800, fontSize: 24, color: C.navy, margin: "0 0 4px" }}>Park with confidence. <span style={{ color: C.amber }}>Share</span> with confidence.</h1>
          <P style={{ marginTop: 14 }}>Park<b>Share</b> brings Hosts and Drivers together through a simple idea: making better use of parking spaces that already exist.</P>
          <P>For that marketplace to work, both sides need to feel confident using it.</P>
          <P>That's why we're building ParkShare around transparency, accountability, secure transactions and respect for people and property.</P>
          <P style={{ margin: 0 }}>Whether you're reserving a space or sharing one, we want you to know what to expect before you arrive.</P>
        </section>

        {/* Community */}
        <section id="community" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.navy, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>A Community Built on Trust</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.white, margin: "0 0 12px" }}>Great parking starts with great people.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>ParkShare is a community of Hosts who share their available parking spaces and Drivers looking for convenient places to park.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>Trust works both ways.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>Hosts are expected to provide accurate information about their parking space, availability, access and any important parking instructions.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>Drivers are expected to respect the property they're visiting, park only in their reserved space and follow the Host's reasonable parking instructions.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: 0 }}>When everyone does their part, ParkShare works better for everyone.</p>
        </section>

        {/* Clear, Accurate Listings */}
        <section id="listings" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Clear, Accurate Listings</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Know what to expect before you arrive.</p>
          <P>A great parking experience starts with good information.</P>
          <P>ParkShare encourages Hosts to provide clear and accurate details about their parking spaces, including:</P>
          <UL items={["Location", "Availability", "Pricing", "Photos", "Space characteristics", "Vehicle restrictions", "Access instructions", "Other important information Drivers should know before booking"]} />
          <P>Drivers should review the complete listing before making a reservation to ensure the space is suitable for their vehicle and needs.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>No surprises. Just better-informed parking decisions.</P>
        </section>

        {/* Secure Payments */}
        <section id="payments" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.amberLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🔒</div>
            <h2 style={{ fontWeight: 700, fontSize: 16, color: C.navy, margin: 0 }}>Secure Payments</h2>
          </div>
          <p style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, margin: "0 0 10px" }}>Simple transactions. Secure payment processing.</p>
          <P>ParkShare is designed to make paying for parking straightforward.</P>
          <P>Payments are processed through ParkShare's secure payment infrastructure so Hosts and Drivers don't need to arrange cash payments or exchange payment information directly with one another.</P>
          <P>Drivers can reserve and pay through the ParkShare platform, while Hosts can manage their earnings and eligible payouts through their account.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>Simple for Drivers. Simple for Hosts.</P>
        </section>

        {/* Ratings & Reviews */}
        <section id="reviews" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Ratings &amp; Reviews</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Better experiences start with accountability.</p>
          <P>Community feedback helps marketplaces become stronger.</P>
          <P>Ratings and reviews can help Drivers make informed decisions about where they park while helping great Hosts build their reputation within the ParkShare community.</P>
          <P>They also encourage everyone to provide the kind of experience they'd want to receive themselves.</P>
          <P style={{ margin: 0 }}>As the ParkShare community grows, authentic feedback will become an important part of helping Hosts and Drivers make confident decisions.</P>
        </section>

        {/* Respect for People & Property */}
        <section id="respect" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.amber, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.navy, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, opacity: 0.75 }}>Respect for People &amp; Property</div>
          <p style={{ fontWeight: 800, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Treat every space like it's your own.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 8px" }}>Every ParkShare parking space belongs to someone.</p>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, margin: "0 0 4px" }}>Drivers should:</p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
            {["Park only in the space they've reserved", "Follow the Host's parking and access instructions", "Arrive and leave within the reserved booking period", "Avoid blocking entrances, vehicles, sidewalks or neighbouring properties", "Leave the space as they found it", "Communicate respectfully"].map((t, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.7, color: C.navy, marginBottom: 4 }}>{t}</li>
            ))}
          </ul>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, margin: "0 0 4px" }}>Hosts should:</p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
            {["Make sure the listed space is actually available", "Provide accurate information and instructions", "Keep access to the reserved space reasonably clear", "Clearly disclose relevant restrictions", "Respect the Driver's reservation", "Communicate respectfully"].map((t, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.7, color: C.navy, marginBottom: 4 }}>{t}</li>
            ))}
          </ul>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, margin: 0 }}>A little consideration goes a long way.</p>
        </section>

        {/* Your Information Matters */}
        <section id="privacy" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Your Information Matters</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Privacy is part of trust.</p>
          <P>Using a marketplace requires sharing certain information.</P>
          <P>ParkShare is committed to handling personal information responsibly and using it to operate and improve the platform, facilitate reservations, support users and provide the services described in our policies.</P>
          <P>We believe users should understand how their information is handled.</P>
          <P style={{ margin: 0 }}>
            For additional information, please review ParkShare's{" "}
            <span onClick={onLegalClick} style={{ color: C.moss, textDecoration: "underline", fontWeight: 600, cursor: "pointer" }}>Privacy Policy and Terms of Service</span>.
          </P>
        </section>

        {/* Before You Park */}
        <section id="before-park" style={{ scrollMarginTop: 20, marginBottom: 16, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.amberLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🚗</div>
            <h2 style={{ fontWeight: 700, fontSize: 16, color: C.navy, margin: 0 }}>Before You Park</h2>
          </div>
          <p style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, margin: "0 0 10px" }}>A few seconds of preparation can make every booking easier.</p>
          <P>Before arriving, Drivers should review:</P>
          <UL items={["The parking address", "Their reservation start and end times", "Listing photographs", "Access instructions", "Vehicle or space restrictions", "Any additional Host instructions"]} />
          <P>If something doesn't look right, don't guess.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>Use ParkShare's available support or communication tools to get clarification.</P>
        </section>

        {/* Before You Host */}
        <section id="before-host" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.amberLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🏠</div>
            <h2 style={{ fontWeight: 700, fontSize: 16, color: C.navy, margin: 0 }}>Before You Host</h2>
          </div>
          <p style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, margin: "0 0 10px" }}>Set your Drivers up for a great experience.</p>
          <P>Before making a space available, Hosts should make sure:</P>
          <UL items={["The listing accurately represents the parking space", "The space will be available during listed times", "Photographs are current", "Instructions are clear", "Any restrictions are disclosed", "Drivers can reasonably identify the correct parking space when they arrive"]} />
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>Clear listings create confident Drivers — and better parking experiences.</P>
        </section>

        {/* Something Went Wrong? */}
        <section id="support" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.navy, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Something Went Wrong?</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.white, margin: "0 0 12px" }}>We're here to help.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>Even with good planning, questions or problems can occasionally happen.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>If you experience an issue with a reservation, parking space, payment or another ParkShare user, use the ParkShare support options available through the platform.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>Providing the reservation details and a clear explanation of what happened will help us better understand the situation.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 14px" }}>For urgent situations involving personal safety, property damage or an emergency, contact the appropriate local emergency or public safety service first.</p>
          <button onClick={onContactClick} style={{ background: "none", border: "none", padding: 0, color: C.amber, textDecoration: "underline", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Contact support →</button>
        </section>

        {/* Building a Better Parking Community + closing */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Building a Better Parking Community</div>
          <P>ParkShare isn't simply connecting cars with empty spaces.</P>
          <P>We're creating a marketplace built around better use of the space communities already have.</P>
          <P>That requires trust. It requires accountability.</P>
          <P>And it requires Hosts and Drivers who treat one another — and the places they share — with respect.</P>
          <P style={{ margin: 0 }}>We're committed to continuing to improve the ParkShare experience as our community grows.</P>
        </section>

        <section style={{ textAlign: "center", marginBottom: 28 }}>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 6px" }}>Parking should feel simple. And it should feel secure.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "#333", margin: "0 0 20px" }}>ParkShare is building a community where Hosts and Drivers can connect with confidence.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={onDriverClick} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 12, padding: "14px 26px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Find Parking</button>
            <button onClick={onHostClick} style={{ background: C.navy, color: C.white, border: "none", borderRadius: 12, padding: "14px 26px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Become a Host</button>
          </div>
        </section>
      </div>

      <Footer onLegalClick={onLegalClick} onContactClick={onContactClick} onTrustClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); }} onAboutClick={onAboutClick} onHelpClick={onHelpClick} />
    </div>
  );
}

// ─── About page — the company story, mission, vision, and Parker's role,
// using the same pill-nav pattern as the Trust page for a long, section-
// based read. Closing CTAs route straight into the Driver/Host pages.
// ─────────────────────────────────────────────────────────────────────────────
const ABOUT_SECTIONS = [
  { id: "about", icon: "🅿️", title: "About" },
  { id: "mission", icon: "🎯", title: "Mission" },
  { id: "vision", icon: "🔭", title: "Vision" },
  { id: "hosts", icon: "🏠", title: "Hosts" },
  { id: "drivers", icon: "🚗", title: "Drivers" },
  { id: "parker", icon: "👋", title: "Meet Parker" },
  { id: "canadian", icon: "🇨🇦", title: "Canadian" },
];

function AboutPage({ tab, onTabChange, onLogoClick, user, onShowAuth, onSignOut, onLegalClick, onContactClick, onTrustClick, onHostClick, onDriverClick, onHelpClick }) {
  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const P = ({ children, style }) => (
    <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 12px", ...style }}>{children}</p>
  );
  return (
    <div style={{ minHeight: "100vh", background: C.warmWhite }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');`}</style>
      <Header tab={tab} onTabChange={onTabChange} onLogoClick={onLogoClick} user={user} onShowAuth={onShowAuth} onSignOut={onSignOut} />

      {/* On-page nav — same pill button style used throughout the app */}
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "20px 20px 0", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {ABOUT_SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            style={{ background: C.amber, border: "2px solid " + C.white, boxShadow: "0 0 0 2px " + C.navy, color: C.navy, borderRadius: 20, fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11.5, padding: "7px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
          >
            <span>{s.icon}</span>{s.title}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 460, margin: "0 auto", padding: "20px 24px 0", fontFamily: "'Poppins', sans-serif" }}>

        {/* About ParkShare */}
        <section id="about" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <h1 style={{ fontWeight: 800, fontSize: 24, color: C.navy, margin: "0 0 4px" }}>About Park<span style={{ color: C.amber }}>Share</span></h1>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 14px" }}>There's space all around us. Let's put it to better use.</p>
          <P>Every day, millions of parking spaces sit empty while drivers circle neighbourhoods, commute to work, attend events, visit businesses and search for somewhere convenient to park.</P>
          <P>We saw an opportunity to connect the two.</P>
          <P>Park<b>Share</b> is Canada's driveway rental marketplace — connecting people who have parking space with people who need it.</P>
          <P>Homeowners can turn an underused driveway or parking space into an opportunity to earn additional income, while drivers gain access to convenient parking in the places they actually want to be.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>Simple for Hosts. Convenient for Drivers. Better use of the space we already have.</P>
        </section>

        {/* Our Mission */}
        <section id="mission" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.navy, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Our Mission</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.white, margin: "0 0 12px" }}>Unlock the potential of every parking space.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>Our mission is to make parking easier by connecting drivers with homeowners and property owners who have space to share.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>For Hosts, that means creating value from space that might otherwise sit empty.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>For Drivers, it means more choice, greater convenience and the ability to know where they're going to park before they arrive.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: 0 }}>ParkShare brings both sides together in one simple marketplace.</p>
        </section>

        {/* Our Vision */}
        <section id="vision" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Our Vision</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>A world where finding parking is effortless.</p>
          <P>We envision communities where existing parking spaces are used more intelligently.</P>
          <P>Where a driveway sitting empty during the day can serve someone working nearby.</P>
          <P>Where a parking space near a stadium can help a fan get to the game.</P>
          <P>Where a homeowner can earn additional income from something they already own.</P>
          <P>And where drivers can spend less time searching for parking and more time getting where they need to go.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>We believe the future of parking isn't just about building more spaces. It's about making better use of the spaces we already have.</P>
        </section>

        {/* One Marketplace. Shared Value. */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 19, color: C.navy }}>One Marketplace. Shared Value.</div>
        </div>

        <section id="hosts" style={{ scrollMarginTop: 20, marginBottom: 16, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.amberLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🏠</div>
            <h2 style={{ fontWeight: 700, fontSize: 16, color: C.navy, margin: 0 }}>For Hosts</h2>
          </div>
          <p style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, margin: "0 0 10px" }}>Your empty space has potential.</p>
          <P>Whether your driveway is available every weekday, only during certain hours, or occasionally during local events, ParkShare gives you a way to put that space to work.</P>
          <P>You control when your space is available. You control your listing. And you decide when you want to share it.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>Your driveway. Your schedule. Your opportunity.</P>
        </section>

        <section id="drivers" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.amberLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>🚗</div>
            <h2 style={{ fontWeight: 700, fontSize: 16, color: C.navy, margin: 0 }}>For Drivers</h2>
          </div>
          <p style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, margin: "0 0 10px" }}>Know where you're going to park before you arrive.</p>
          <P>ParkShare is designed to make finding parking simpler.</P>
          <P>Discover available spaces, compare your options, reserve a spot and head to your destination knowing your parking is waiting for you.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>Less searching. Less uncertainty. Better parking.</P>
        </section>

        {/* Meet Parker */}
        <section id="parker" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Meet Parker</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Your friendly guide to better parking.</p>
          <ParkerTip pose="fullbody" style={{ marginBottom: 12 }}>
            Parker is more than our mascot — he's here to make hosting and parking feel simple.
          </ParkerTip>
          <P>Parker is more than our mascot. He represents what we want every interaction with ParkShare to feel like: friendly, helpful, approachable and easy.</P>
          <P>Whether you're listing your first driveway or looking for a spot near your destination, Parker is here to help make the experience a little simpler — and a lot more fun.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>Because parking doesn't have to be complicated.</P>
        </section>

        {/* Proudly Canadian */}
        <section id="canadian" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.amber, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.navy, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, opacity: 0.75 }}>Proudly Canadian</div>
          <p style={{ fontWeight: 800, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Built in Canada. Designed for communities everywhere.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 10px" }}>ParkShare was created in Canada around a simple idea: communities already have an enormous amount of parking infrastructure sitting unused.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 10px" }}>By connecting those spaces with the people who need them, we can create new opportunities for homeowners, more choices for drivers and better utilization of the communities we've already built.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, fontWeight: 700, margin: 0 }}>We're starting at home. But our vision goes much further.</p>
        </section>

        {/* We're Just Getting Started — closing */}
        <section style={{ textAlign: "center", marginBottom: 28 }}>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 10px" }}>We're Just Getting Started</p>
          <P style={{ textAlign: "center" }}>ParkShare isn't simply about finding somewhere to leave your car. It's about unlocking something that has been hiding in plain sight.</P>
          <p style={{ fontWeight: 800, fontSize: 16, color: C.navy, margin: "0 0 20px" }}>Millions of spaces. Millions of destinations. One marketplace connecting them. And we're only getting started.</p>

          <div style={{ fontWeight: 800, fontSize: 18, color: C.navy, marginBottom: 14 }}>Ready to ParkShare?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={onDriverClick} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 12, padding: "14px 26px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Find Parking</button>
            <button onClick={onHostClick} style={{ background: C.navy, color: C.white, border: "none", borderRadius: 12, padding: "14px 26px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Become a Host</button>
          </div>
        </section>
      </div>

      <Footer onLegalClick={onLegalClick} onContactClick={onContactClick} onTrustClick={onTrustClick} onAboutClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); }} onHelpClick={onHelpClick} />
    </div>
  );
}

// A richer, host-specific calculator matching the "Estimate Your Potential"
// fields in the new Host page copy (price, days/week, average bookings)
// rather than the simpler hours-per-day slider used on the homepage.
function HostEarningsCalculator() {
  const [price, setPrice] = useState(12);
  const [days, setDays] = useState(5);
  const [avgBookings, setAvgBookings] = useState(3);
  const monthly = Math.round(price * avgBookings * days * 4.33);
  const annual = monthly * 12;

  const fieldStyle = { textAlign: "left", marginBottom: 16 };
  const labelRow = { display: "flex", justifyContent: "space-between", marginBottom: 6 };
  const labelText = { fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 12.5, color: "rgba(255,255,255,0.85)" };
  const valueText = { fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 12.5, color: C.amber };

  return (
    <div className="ps-host-calculator" style={{ background: C.navy, borderRadius: 18, padding: "22px 20px", textAlign: "center" }}>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Estimate Your Potential</div>
      <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 15, color: C.white, marginBottom: 18 }}>What could your driveway earn?</div>

      <div style={fieldStyle}>
        <div style={labelRow}><span style={labelText}>Your price (per hour)</span><span style={valueText}>${price}/hr</span></div>
        <input type="range" min={5} max={30} step={1} value={price} onChange={e => setPrice(Number(e.target.value))} style={{ width: "100%", accentColor: C.amber, cursor: "pointer" }} />
      </div>

      <div style={fieldStyle}>
        <div style={labelRow}><span style={labelText}>Available days per week</span><span style={valueText}>{days} day{days !== 1 ? "s" : ""}</span></div>
        <input type="range" min={1} max={7} step={1} value={days} onChange={e => setDays(Number(e.target.value))} style={{ width: "100%", accentColor: C.amber, cursor: "pointer" }} />
      </div>

      <div style={fieldStyle}>
        <div style={labelRow}><span style={labelText}>Average bookings (hrs/day)</span><span style={valueText}>{avgBookings} hr{avgBookings !== 1 ? "s" : ""}</span></div>
        <input type="range" min={1} max={10} step={1} value={avgBookings} onChange={e => setAvgBookings(Number(e.target.value))} style={{ width: "100%", accentColor: C.amber, cursor: "pointer" }} />
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.15)", paddingTop: 16, marginTop: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 12.5, color: "rgba(255,255,255,0.75)" }}>Estimated Monthly Earnings</span>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 14, color: C.white }}>${monthly.toLocaleString()}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 600, fontSize: 12.5, color: "rgba(255,255,255,0.75)" }}>Estimated Annual Earnings</span>
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 18, color: C.amber }}>${annual.toLocaleString()}</span>
        </div>
      </div>

      <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 400, fontSize: 10, color: "rgba(255,255,255,0.55)", margin: "16px 0 0", lineHeight: 1.5 }}>
        Estimates are illustrative only. Actual bookings and earnings vary based on availability, pricing, location, demand and other factors. ParkShare does not guarantee earnings.
      </p>
    </div>
  );
}

const HOST_SECTIONS = [
  { id: "earn", icon: "💰", title: "Earnings" },
  { id: "control", icon: "🎛️", title: "Control" },
  { id: "steps", icon: "📝", title: "How It Works" },
  { id: "why", icon: "⭐", title: "Why Host" },
  { id: "faq", icon: "❓", title: "FAQ" },
];

const HOST_FAQS = [
  { q: "Do I decide when my driveway is available?", a: "Yes. Your listing should reflect when you want your parking space available for reservations." },
  { q: "Do I set my own price?", a: "Hosts can select pricing using the options currently available through ParkShare. Your location, demand and nearby parking alternatives can all influence an appropriate price." },
  { q: "Does my driveway have to be available every day?", a: "No. ParkShare is designed around flexible availability." },
  { q: "What if I need my driveway back?", a: "Keep your availability current and avoid making your space bookable when you expect to need it. Existing confirmed reservations should be handled according to ParkShare's applicable cancellation policies." },
  { q: "What type of parking space can I list?", a: "Eligible private parking spaces will need to comply with ParkShare's listing requirements and applicable local rules." },
  { q: "How do I get paid?", a: "Eligible Host earnings are distributed according to ParkShare's payout process and applicable terms." },
  { q: "Is hosting right for every property?", a: "Not necessarily. Hosts are responsible for making sure they're permitted to offer their parking space and for following applicable property, municipal, condominium, lease or other requirements." },
  { q: "Where can I learn more about safety?", a: "Visit ParkShare's Trust & Safety page for information about community expectations, listings, payments, privacy and responsible use of the marketplace." },
];

// ─── Host page — dedicated landing spot for the "For hosts" homepage card.
// Full policy-style page (hero, value prop, calculator, how-it-works,
// flexibility, location angle, benefits, host standards, FAQ, Parker tip,
// closing) using the same pill-nav pattern as Trust & Safety and About.
// ─────────────────────────────────────────────────────────────────────────────
function HostPage({ tab, onTabChange, onLogoClick, user, onShowAuth, onSignOut, onLegalClick, onContactClick, onTrustClick, onGetStarted, onAboutClick, onHelpClick }) {
  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const P = ({ children, style }) => (
    <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 12px", ...style }}>{children}</p>
  );
  const UL = ({ items, style }) => (
    <ul style={{ margin: "0 0 12px", paddingLeft: 20, ...style }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", marginBottom: 4 }}>{item}</li>
      ))}
    </ul>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.warmWhite }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');`}</style>
      <Header tab={tab} onTabChange={onTabChange} onLogoClick={onLogoClick} user={user} onShowAuth={onShowAuth} onSignOut={onSignOut} onHostClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} onAboutClick={onAboutClick} onTrustClick={onTrustClick} onHelpClick={onHelpClick} />

      {/* Hero */}
      <div className="ps-host-hero" style={{ maxWidth: 460, margin: "0 auto", background: C.amber, padding: "32px 24px 26px", textAlign: "center" }}>
        <div className="ps-host-hero-copy">
          <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11, color: C.navy, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, opacity: 0.75 }}>Become a ParkShare Host</div>
          <h1 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 25, color: C.navy, lineHeight: 1.3, margin: "0 0 16px" }}>Your driveway could be earning while you're not using it.</h1>
          <p className="ps-host-hero-subcopy">Turn unused parking space into additional income while staying in control of your schedule, pricing and listing.</p>
          <button onClick={onGetStarted} style={{ background: C.navy, color: C.white, border: "none", borderRadius: 12, padding: "13px 28px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>List Your Space</button>
        </div>
        <div className="ps-host-hero-visual" aria-hidden="true">
          <img src={PARKER.savings} alt="" />
          <div><strong>Your space.</strong><span>Your schedule. Your opportunity.</span></div>
        </div>
      </div>

      {/* On-page nav */}
      <div className="ps-host-section-nav" style={{ maxWidth: 460, margin: "0 auto", padding: "20px 20px 0", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {HOST_SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            style={{ background: C.amber, border: "2px solid " + C.white, boxShadow: "0 0 0 2px " + C.navy, color: C.navy, borderRadius: 20, fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11.5, padding: "7px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
          >
            <span>{s.icon}</span>{s.title}
          </button>
        ))}
      </div>

      <div className="ps-host-content" style={{ maxWidth: 460, margin: "0 auto", padding: "20px 24px 0", fontFamily: "'Poppins', sans-serif" }}>

        <section className="ps-host-intro" style={{ marginBottom: 20 }}>
          <P>Every day, driveways and private parking spaces sit empty for hours at a time.</P>
          <P style={{ margin: "0 0 4px" }}>While you're at work.</P>
          <P style={{ margin: "0 0 4px" }}>While you're away.</P>
          <P style={{ margin: "0 0 4px" }}>During events nearby.</P>
          <P>Or simply because you have more parking space than you need.</P>
          <P>ParkShare helps you turn that unused space into an opportunity.</P>
          <P>List your available parking space, choose when it's available and connect with Drivers looking for convenient parking nearby.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>Your space. Your schedule. Your opportunity.</P>
        </section>

        {/* Space You Already Have */}
        <section id="value" className="ps-host-value" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.navy, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Put the Space You Already Have to Work.</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.white, margin: "0 0 12px" }}>Put your empty parking space to work.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 6px" }}>You don't need to build anything.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 6px" }}>You don't need another property.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>You already have the asset.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>ParkShare gives homeowners and property owners a way to make better use of parking space that might otherwise sit empty.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>Whether your space is available every weekday or only occasionally, you decide when sharing makes sense for you.</p>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.amber, margin: 0 }}>Empty driveway? Put it to work.</p>
        </section>

        {/* What Could Your Driveway Earn */}
        <section id="earn" className="ps-host-earn" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>What Could Your Driveway Earn?</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>A little unused space can add up.</p>
          <P className="ps-host-earn-intro">Your earning potential can depend on several factors. The strongest opportunities usually combine the right location, useful availability and local demand.</P>
          <div className="ps-host-earn-factors">
            {[
              ["📍", "Location", "Where your space is matters."],
              ["🚗", "Demand", "Nearby parking needs can change by day and time."],
              ["🕐", "Availability", "More useful hours can create more booking opportunities."],
              ["🎟️", "Events", "Venues and events can create concentrated demand."],
              ["💵", "Pricing", "Your rate helps shape the value of each booking."],
            ].map(([icon, title, desc]) => (
              <div key={title}><span>{icon}</span><strong>{title}</strong><small>{desc}</small></div>
            ))}
          </div>
          <P>A driveway near a commuter station might be valuable during weekdays.</P>
          <P>A space near a stadium or entertainment district might see greater demand during events.</P>
          <P>A driveway near a hospital, university or busy commercial area could serve Drivers throughout the week.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: "0 0 16px" }}>The opportunity is different for every Host.</P>

          <HostEarningsCalculator />
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <button onClick={onGetStarted} style={{ background: C.navy, color: C.white, border: "none", borderRadius: 12, padding: "13px 28px", fontFamily: "'Poppins', sans-serif", fontSize: 13.5, fontWeight: 700, cursor: "pointer", width: "100%" }}>See What Your Space Could Earn</button>
          </div>
        </section>

        {/* You're Always in Control */}
        <section id="control" className="ps-host-control" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>You're Always in Control</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Share your driveway on your terms.</p>
          <P>It's your property. You decide how you want to use it.</P>
          <P>With ParkShare, Hosts can manage important aspects of their listing, including:</P>
          <div className="ps-host-control-grid" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
            {[
              { t: "Availability", d: "Choose when your parking space is available." },
              { t: "Pricing", d: "Set the price for your space using the pricing options available through ParkShare." },
              { t: "Parking Instructions", d: "Tell Drivers exactly where and how to park." },
              { t: "Listing Details", d: "Provide photographs, space information and important restrictions." },
              { t: "Your Schedule", d: "Make your space available when it works for you." },
            ].map((row, i) => (
              <div key={i} style={{ background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, marginBottom: 2 }}>{row.t}</div>
                <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{row.d}</div>
              </div>
            ))}
          </div>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>You decide when your driveway works for you — and when it works for someone else.</P>
        </section>

        {/* Hosting Made Simple */}
        <section id="steps" className="ps-host-steps" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Hosting Made Simple</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 14px" }}>From empty driveway to active listing.</p>
          <div className="ps-host-steps-grid" style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
            {[
              { n: 1, t: "Create Your Listing", d: "Tell Drivers about your parking space. Add your location, photographs, availability, parking details and instructions." },
              { n: 2, t: "Set Your Availability", d: "Choose when Drivers can reserve your space. Weekdays. Weekends. Events. Certain hours. You decide." },
              { n: 3, t: "Set Your Price", d: "Choose a price that makes sense for your space and location using the options available through ParkShare." },
              { n: 4, t: "Welcome Your Driver", d: "When your space is booked, make sure it's available and ready during the reservation period. Clear instructions help Drivers find the correct space quickly." },
              { n: 5, t: "Get Paid", d: "Eligible Host earnings are paid according to ParkShare's applicable payout process and terms." },
            ].map(step => (
              <div key={step.n} style={{ display: "flex", gap: 12, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.navy, color: C.amber, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{step.n}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.navy, marginBottom: 3 }}>{step.t}</div>
                  <div style={{ fontSize: 12.5, color: "#333", lineHeight: 1.6 }}>{step.d}</div>
                </div>
              </div>
            ))}
          </div>
          <P style={{ fontWeight: 700, color: C.navy, margin: "0 0 16px" }}>That's it. Your empty parking space just became useful.</P>
          <button onClick={onGetStarted} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 12, padding: "13px 28px", fontFamily: "'Poppins', sans-serif", fontSize: 13.5, fontWeight: 700, cursor: "pointer", width: "100%" }}>Create Your Listing</button>
        </section>

        {/* Hosting That Fits Your Life */}
        <section id="flexible" className="ps-host-flexible" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.amber, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.navy, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, opacity: 0.75 }}>Hosting That Fits Your Life</div>
          <p style={{ fontWeight: 800, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>You don't have to become a full-time Host.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 12px" }}>One of the advantages of ParkShare is flexibility. Your driveway might only be available:</p>
          <div className="ps-host-flexible-grid" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
            {[
              { t: "While you're at work", d: "Turn daytime vacancy into an opportunity." },
              { t: "When you're travelling", d: "Going away? Your parking space doesn't have to sit empty." },
              { t: "During local events", d: "Concerts, sporting events, festivals and community events can create parking demand." },
              { t: "On weekdays", d: "Live near offices, transit or a university? Commuters may need your space." },
              { t: "On weekends", d: "Some locations experience their highest demand when the workweek ends." },
            ].map((row, i) => (
              <div key={i} style={{ background: "rgba(14,27,46,0.08)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: C.navy }}>{row.t}</div>
                <div style={{ fontSize: 12, color: C.navy, opacity: 0.8, marginTop: 2 }}>{row.d}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 8px" }}>Or you may decide to make your space available regularly.</p>
          <p style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, margin: 0 }}>There is no single way to ParkShare.</p>
        </section>

        {/* Location Creates Opportunity */}
        <section id="location" className="ps-host-location" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Location Creates Opportunity</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Think about what's around you.</p>
          <P>Parking demand isn't limited to downtown. Drivers need parking near:</P>
          <UL items={["Transit stations", "Hospitals", "Universities and colleges", "Office districts", "Shopping areas", "Restaurants", "Entertainment districts", "Sporting venues", "Airports", "Tourist destinations", "Festivals and events", "Busy neighbourhoods"]} />
          <P style={{ margin: 0 }}>Sometimes a driveway that seems ordinary to you could be exactly where someone else needs to park.</P>
        </section>

        {/* Why Host With ParkShare */}
        <section id="why" className="ps-host-why" style={{ scrollMarginTop: 20, marginBottom: 16 }}>
          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Why Host With ParkShare?</div>
            <p style={{ fontWeight: 800, fontSize: 18, color: C.navy, margin: "0 0 16px" }}>More than an empty driveway.</p>
          </div>
          <div className="ps-host-why-grid" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {[
              { icon: "💵", t: "Create Additional Income", d: "Put unused parking space to productive use." },
              { icon: "🎛️", t: "Stay in Control", d: "Choose your availability, listing details and applicable pricing options." },
              { icon: "🏠", t: "Use What You Already Have", d: "No new property. No additional parking space to build." },
              { icon: "🤝", t: "Help Drivers Nearby", d: "Provide another parking option for people travelling to destinations in your community." },
              { icon: "🌍", t: "Be Part of Something Bigger", d: "Help create a marketplace that makes better use of existing spaces." },
            ].map((row, i) => (
              <div key={i} style={{ display: "flex", gap: 12, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.amberLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{row.icon}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.navy, marginBottom: 2 }}>{row.t}</div>
                  <div style={{ fontSize: 12.5, color: "#333", lineHeight: 1.5 }}>{row.d}</div>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, textAlign: "center", margin: 0 }}>One driveway might seem small. Thousands of them can change how a city parks.</p>
        </section>

        <div style={{ marginBottom: 28 }} />

        {/* Great Hosts Create Great Experiences */}
        <section id="great" className="ps-host-great" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.navy, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Great Hosts Create Great Experiences</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.white, margin: "0 0 12px" }}>A few simple things make a big difference.</p>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: "0 0 6px" }}>Great ParkShare Hosts:</p>
          <ul style={{ margin: "0 0 14px", paddingLeft: 20 }}>
            {["Keep listing information accurate", "Provide current photographs", "Clearly describe where Drivers should park", "Disclose important restrictions", "Keep the reserved space accessible", "Honour confirmed reservations", "Communicate clearly and respectfully", "Keep availability up to date"].map((t, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.85)", marginBottom: 4 }}>{t}</li>
            ))}
          </ul>
          <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.8)", margin: "0 0 4px" }}>Good information creates confident Drivers.</p>
          <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.8)", margin: "0 0 4px" }}>Confident Drivers create better experiences.</p>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.amber, margin: 0 }}>Better experiences help build a stronger ParkShare community.</p>
        </section>

        {/* FAQ */}
        <section id="faq" className="ps-host-faq" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Questions About Hosting?</div>
            <p style={{ fontWeight: 800, fontSize: 18, color: C.navy, margin: 0 }}>We've got answers.</p>
          </div>
          <div className="ps-host-faq-grid" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {HOST_FAQS.map((f, i) => (
              <div key={i} style={{ background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, marginBottom: 5 }}>{f.q}</div>
                <div style={{ fontSize: 12.5, color: "#333", lineHeight: 1.65 }}>{f.a}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Parker's Host Tip */}
        <section className="ps-host-parker-tip" style={{ marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Meet Parker's Host Tip</div>
          <ParkerTip pose="fullbody">
            Your driveway doesn't need to be available all the time to have value. Start with the hours you know you don't normally use it — you can adjust your availability as you learn what works best for you.
          </ParkerTip>
          <p style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, textAlign: "center", margin: "12px 0 0" }}>Start simple. Stay in control. Put your empty space to work.</p>
        </section>

        {/* Closing */}
        <section className="ps-host-closing" style={{ textAlign: "center", marginBottom: 28 }}>
          <p style={{ fontWeight: 700, fontSize: 16, color: C.navy, margin: "0 0 4px" }}>Your Driveway Is Already There.</p>
          <p style={{ fontSize: 13.5, color: C.muted, margin: "0 0 14px" }}>Maybe it's time it did a little more.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "#333", margin: "0 0 4px" }}>Every parking space has a location.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "#333", margin: "0 0 4px" }}>Every location has potential.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "#333", margin: "0 0 16px" }}>And somewhere nearby, someone may be looking for exactly the space you have.</p>
          <p style={{ fontWeight: 800, fontSize: 16, color: C.navy, margin: "0 0 20px" }}>Turn your empty driveway into opportunity with ParkShare.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={onGetStarted} style={{ background: C.navy, color: C.white, border: "none", borderRadius: 12, padding: "14px 26px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>List Your Space</button>
            <button onClick={onTrustClick} style={{ background: "none", border: "none", padding: 0, color: C.moss, textDecoration: "underline", fontFamily: "'Poppins', sans-serif", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Learn About Trust &amp; Safety →</button>
          </div>
        </section>
      </div>

      <Footer onLegalClick={onLegalClick} onContactClick={onContactClick} onTrustClick={onTrustClick} onAboutClick={onAboutClick} onHelpClick={onHelpClick} />
    </div>
  );
}

const DRIVER_SECTIONS = [
  { id: "how", icon: "🔎", title: "How It Works" },
  { id: "choice", icon: "🗺️", title: "More Choice" },
  { id: "know", icon: "✅", title: "Know Before You Go" },
  { id: "fits", icon: "🕐", title: "Fits Your Plans" },
  { id: "confidence", icon: "🛡️", title: "Confidence" },
];

// ─── Driver page — dedicated landing spot for the "For drivers" homepage
// card. Full policy-style page (hero, how-it-works, choice, certainty,
// flexibility, convenience, trust, Meet Parker, closing) using the same
// pill-nav pattern as Trust & Safety, About, and the Host page.
// ─────────────────────────────────────────────────────────────────────────────
function DriverPage({ tab, onTabChange, onLogoClick, user, onShowAuth, onSignOut, onLegalClick, onContactClick, onTrustClick, onFindParking, onAboutClick, onHostClick, onHelpClick }) {
  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const P = ({ children, style }) => (
    <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 12px", ...style }}>{children}</p>
  );
  const UL = ({ items, style }) => (
    <ul style={{ margin: "0 0 12px", paddingLeft: 20, ...style }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", marginBottom: 4 }}>{item}</li>
      ))}
    </ul>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.warmWhite }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');`}</style>
      <Header tab={tab} onTabChange={onTabChange} onLogoClick={onLogoClick} user={user} onShowAuth={onShowAuth} onSignOut={onSignOut} />

      {/* Hero */}
      <div style={{ maxWidth: 460, margin: "0 auto", background: C.navy, padding: "32px 24px 26px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Park with ParkShare</div>
        <h1 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 25, color: C.white, lineHeight: 1.3, margin: "0 0 16px" }}>Your parking spot is waiting for you.</h1>
        <button onClick={onFindParking} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 12, padding: "13px 28px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Find Parking</button>
      </div>

      {/* On-page nav */}
      <div style={{ maxWidth: 460, margin: "0 auto", padding: "20px 20px 0", display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {DRIVER_SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            style={{ background: C.amber, border: "2px solid " + C.white, boxShadow: "0 0 0 2px " + C.navy, color: C.navy, borderRadius: 20, fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11.5, padding: "7px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
          >
            <span>{s.icon}</span>{s.title}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 460, margin: "0 auto", padding: "20px 24px 0", fontFamily: "'Poppins', sans-serif" }}>

        <section style={{ marginBottom: 28 }}>
          <P>Finding parking shouldn't be the hardest part of getting somewhere.</P>
          <P>ParkShare helps Drivers discover available parking spaces offered by local Hosts — giving you more options in the places you want to go.</P>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Search. Compare. Reserve. Park.</p>
          <P style={{ margin: 0 }}>Spend less time looking for parking and more time getting where you're going.</P>
        </section>

        {/* Parking Made Simple */}
        <section style={{ marginBottom: 28, background: C.navy, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Parking Made Simple</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.white, margin: "0 0 12px" }}>Know where you're going before you arrive.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>We've all been there.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>You're heading to work, meeting friends, attending an event or visiting somewhere new — and then comes the question: Where am I going to park?</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>ParkShare is designed to answer that question before you arrive.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>Search for available parking near your destination, review your options and reserve the space that works for you.</p>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.amber, margin: 0 }}>Your destination shouldn't come with a parking headache.</p>
        </section>

        {/* How ParkShare Works */}
        <section id="how" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>How ParkShare Works</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 14px" }}>From search to parked in four simple steps.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
            {[
              { n: 1, t: "Search", d: "Enter where you're going and when you need parking. ParkShare helps you discover available spaces around your destination." },
              { n: 2, t: "Compare", d: "Review available parking options and choose the space that best fits your needs. Consider location, price, photographs, parking instructions and other listing details before reserving." },
              { n: 3, t: "Reserve", d: "Select your parking space and complete your reservation through ParkShare. Your booking details are kept together so you know where you're going and when your reservation begins." },
              { n: 4, t: "Park", d: "Follow the Host's parking instructions, arrive during your reserved time and park in your designated space." },
            ].map(step => (
              <div key={step.n} style={{ display: "flex", gap: 12, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 14, padding: "14px 16px" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.navy, color: C.amber, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{step.n}</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: C.navy, marginBottom: 3 }}>{step.t}</div>
                  <div style={{ fontSize: 12.5, color: "#333", lineHeight: 1.6 }}>{step.d}</div>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontWeight: 700, fontSize: 13.5, color: C.navy, margin: 0 }}>That's it. You're parked.</p>
        </section>

        {/* More Choice. Less Searching. */}
        <section id="choice" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.amber, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.navy, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, opacity: 0.75 }}>More Choice. Less Searching.</div>
          <p style={{ fontWeight: 800, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Parking where people already have space.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 8px" }}>Traditional parking isn't available everywhere you need it.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 8px" }}>But driveways and private parking spaces are all around us.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 8px" }}>ParkShare helps unlock some of that existing parking capacity by connecting Drivers with Hosts who have space available.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 6px" }}>That can mean more parking choices near:</p>
          <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>
            {["Workplaces", "Transit stations", "Shopping areas", "Restaurants", "Entertainment districts", "Universities and colleges", "Sporting events", "Concerts and festivals", "Hospitals and appointments", "Airports and transportation hubs", "Popular neighbourhood destinations"].map((t, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.7, color: C.navy, marginBottom: 4 }}>{t}</li>
            ))}
          </ul>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, margin: 0 }}>Sometimes the best parking space isn't in a parking garage. It's around the corner.</p>
        </section>

        {/* Know Before You Go */}
        <section id="know" style={{ scrollMarginTop: 20, marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Know Before You Go</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>More certainty before you leave home.</p>
          <P>One of the most frustrating parts of parking is uncertainty.</P>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 4px" }}>Will there be a space?</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 4px" }}>How much will it cost?</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 4px" }}>How far will I have to walk?</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 12px" }}>Where exactly am I supposed to park?</p>
          <P>ParkShare is designed to give Drivers useful information before making a reservation.</P>
          <P>Review the listing, photographs, location, pricing, availability and Host instructions before you book.</P>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>Then head toward your destination knowing you've already taken care of parking.</P>
        </section>

        {/* Parking That Fits Your Plans */}
        <section id="fits" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Parking That Fits Your Plans</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Different destinations. Different parking needs.</p>
          <P>Not every parking trip is the same.</P>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 4px" }}>You might need a space for an hour while you have an appointment.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 4px" }}>A few hours while you attend a game.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 4px" }}>A workday near the office.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 4px" }}>An evening downtown.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "#333", margin: "0 0 12px" }}>Or regular parking near a destination you visit frequently.</p>
          <P style={{ margin: 0 }}>ParkShare gives Hosts the flexibility to make their spaces available at different times — creating more options for Drivers with different parking needs.</P>
        </section>

        {/* Built Around Convenience */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Built Around Convenience</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Your time belongs at your destination — not circling the block.</p>
          <P>Parking shouldn't mean driving around hoping something becomes available.</P>
          <P>ParkShare is designed to make the experience more predictable:</P>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {["Search before you leave.", "Compare your options.", "Reserve your space.", "Follow the directions.", "Park and get on with your day."].map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: C.amber, fontSize: 14 }}>✓</span>
                <span style={{ fontSize: 13.5, color: "#333" }}>{t}</span>
              </div>
            ))}
          </div>
          <P style={{ fontWeight: 700, color: C.navy, margin: 0 }}>Simple parking is better parking.</P>
        </section>

        {/* Parking With Confidence */}
        <section id="confidence" style={{ scrollMarginTop: 20, marginBottom: 28, background: C.navy, borderRadius: 16, padding: "20px 20px" }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Parking With Confidence</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.white, margin: "0 0 12px" }}>Clear information. Secure transactions. A community built on trust.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 10px" }}>ParkShare is building a marketplace where Hosts and Drivers can connect confidently.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 6px" }}>Clear listings help you understand what you're reserving.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 6px" }}>Secure payment processing keeps the transaction within the ParkShare experience.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 6px" }}>Ratings and reviews can help our community make better-informed decisions as ParkShare grows.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: "rgba(255,255,255,0.8)", margin: "0 0 14px" }}>And community standards help establish expectations for both Hosts and Drivers.</p>
          <button onClick={onTrustClick} style={{ background: "none", border: "none", padding: 0, color: C.amber, textDecoration: "underline", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Explore Trust &amp; Safety →</button>
        </section>

        {/* Meet Parker */}
        <section style={{ marginBottom: 28 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Meet Parker</div>
          <p style={{ fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Your parking sidekick.</p>
          <ParkerTip pose="fullbody">
            Parker has one job: help make parking easier. From finding a space to understanding your reservation, he's here to keep it friendly, helpful and uncomplicated.
          </ParkerTip>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "#333", margin: "12px 0 0" }}>Because getting somewhere should be the memorable part of your day. Finding parking shouldn't be.</p>
        </section>

        {/* Great Parking Starts Before You Arrive */}
        <section style={{ marginBottom: 28, background: C.amber, borderRadius: 16, padding: "20px 20px", textAlign: "center" }}>
          <p style={{ fontWeight: 800, fontSize: 15, color: C.navy, margin: "0 0 12px" }}>Great Parking Starts Before You Arrive</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 6px" }}>Imagine heading to a busy destination without wondering where you'll park.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 4px" }}>Your plans are made.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.75, color: C.navy, margin: "0 0 10px" }}>Your destination is set. And your parking is already taken care of.</p>
          <p style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, margin: 0 }}>That's the experience we're building at ParkShare.</p>
        </section>

        {/* Closing */}
        <section style={{ textAlign: "center", marginBottom: 28 }}>
          <p style={{ fontWeight: 800, fontSize: 18, color: C.navy, margin: "0 0 8px" }}>Stop Searching. Start Parking.</p>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: "#333", margin: "0 0 20px" }}>Find convenient parking from local Hosts and get where you're going with one less thing to worry about.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={onFindParking} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 12, padding: "14px 26px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Find Parking</button>
            <button onClick={onHostClick} style={{ background: C.navy, color: C.white, border: "none", borderRadius: 12, padding: "14px 26px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Become a Host</button>
          </div>
        </section>
      </div>

      <Footer onLegalClick={onLegalClick} onContactClick={onContactClick} onTrustClick={onTrustClick} onAboutClick={onAboutClick} onHelpClick={onHelpClick} />
    </div>
  );
}

// ─── Help Centre content, grouped by audience then sub-topic. Kept as data
// (not JSX) so the accordion/search UI below can filter and render it
// generically, and so adding a question later is a one-line edit.
// ─────────────────────────────────────────────────────────────────────────────
const HELP_DATA = [
  {
    id: "drivers", icon: "🚗", title: "Drivers",
    groups: [
      { sub: "Finding & Booking Parking", items: [
        { q: "How do I find parking?", a: "Enter the location where you need parking and browse available ParkShare spaces nearby. Review the listing details, price, availability and parking instructions before making your reservation." },
        { q: "What should I check before booking?", a: "Review the location, photographs, available times, price, vehicle restrictions and any instructions provided by the Host. Make sure the parking space is suitable for your vehicle before confirming your reservation." },
        { q: "How do I know where to park?", a: "Your reservation and listing information should provide the details you need to identify the correct parking space. Always review the Host's parking instructions before arriving." },
        { q: "Can I book parking in advance?", a: "Where availability allows, ParkShare lets you reserve parking ahead of your arrival so you can plan your trip knowing where you're going to park." },
        { q: "What if there are no spaces near my destination?", a: "Try adjusting your search area, dates or times. ParkShare availability will continue to grow as more Hosts join the community." },
      ]},
      { sub: "Managing Your Reservation", items: [
        { q: "Where can I find my reservation?", a: "Your ParkShare account provides access to your booking information and relevant reservation details." },
        { q: "Can I change my reservation?", a: "Available modification options depend on the reservation and ParkShare's applicable booking policies. Check your reservation details for the options currently available." },
        { q: "Can I extend my parking time?", a: "If additional time is available for the space, ParkShare may provide an option to extend your reservation. Always extend your booking before your existing reservation ends." },
        { q: "What happens if I'm late?", a: "Your reservation only covers the confirmed booking period. If you expect to remain longer, check whether additional time is available and extend your reservation when possible." },
        { q: "What if I can't find the parking space?", a: "Review the listing photographs, address and Host instructions first. If you still cannot identify the correct space, use the available ParkShare communication or support options rather than parking somewhere you're unsure about." },
      ]},
      { sub: "Cancellations", items: [
        { q: "Can I cancel a reservation?", a: "Cancellation options are governed by the cancellation terms applicable to your booking. Review the cancellation information shown during booking and within your reservation." },
        { q: "What if the parking space isn't available when I arrive?", a: "Do not park somewhere else on the property unless you're clearly authorized to do so. Document the issue where appropriate and use ParkShare's available support options so the situation can be reviewed." },
      ]},
    ],
  },
  {
    id: "hosts", icon: "🏠", title: "Hosts",
    groups: [
      { sub: "Getting Started", items: [
        { q: "Who can become a ParkShare Host?", a: "People who have the authority to offer an eligible parking space may be able to list it through ParkShare, subject to ParkShare's applicable terms and policies. Hosts are responsible for ensuring they're permitted to offer the space." },
        { q: "What types of parking spaces can I list?", a: "Eligible spaces may include residential driveways and other suitable private parking spaces where the Host has the authority to offer parking. Listings should accurately describe the space and any relevant restrictions." },
        { q: "How do I create a listing?", a: "Provide the requested information about your parking space, including its location, photographs, availability, pricing, vehicle restrictions and parking instructions. Clear information makes it easier for Drivers to book confidently." },
        { q: "How much should I charge?", a: "Consider your location, nearby destinations, local parking options, availability and demand when choosing your price. As the ParkShare marketplace develops, additional pricing tools may become available to help Hosts make informed decisions." },
      ]},
      { sub: "Availability & Bookings", items: [
        { q: "Do I have to make my space available every day?", a: "No. You decide when your parking space is available." },
        { q: "Can I change my availability?", a: "Yes. Keep your availability current so Drivers can only reserve your space when it's genuinely available." },
        { q: "What if I need my driveway for myself?", a: "Your property remains yours. Update your availability whenever you need the parking space for yourself, household members or guests. Existing confirmed reservations should be respected in accordance with ParkShare's applicable booking policies." },
        { q: "What should I do before a Driver arrives?", a: "Make sure the reserved space is available and reasonably easy to identify. Check that your listing photographs and instructions accurately reflect what the Driver will encounter." },
        { q: "What makes a great ParkShare Host?", a: "Accurate information, clear photographs, reliable availability, straightforward instructions and respectful communication can all contribute to a better Driver experience." },
      ]},
      { sub: "Host Earnings & Payouts", items: [
        { q: "How do Hosts earn money?", a: "When Drivers book eligible parking spaces through ParkShare, Hosts can earn income from those reservations according to ParkShare's applicable pricing, fee and payout terms." },
        { q: "When do I get paid?", a: "Payout timing depends on ParkShare's current payment and payout process. Your account and applicable ParkShare payment information should provide the most current details." },
        { q: "Does ParkShare charge Hosts a fee?", a: "Any applicable ParkShare fees should be clearly disclosed before they apply. Review ParkShare's current pricing and Host terms for details." },
        { q: "Are ParkShare earnings taxable?", a: "Income earned through sharing a parking space may have tax implications. Hosts are responsible for understanding and complying with their own tax obligations. Consider consulting a qualified tax professional if you're unsure how the rules apply to you." },
      ]},
    ],
  },
  {
    id: "payments", icon: "💳", title: "Payments & Accounts",
    groups: [
      { sub: "Payments", items: [
        { q: "How do Drivers pay?", a: "Available payment methods are presented through the ParkShare booking process. Payments should be completed through ParkShare rather than arranging separate cash payments with a Host." },
        { q: "Is my payment information secure?", a: "ParkShare uses payment infrastructure designed to facilitate transactions without requiring Hosts and Drivers to exchange payment information directly. For more information, review ParkShare's Privacy Policy and applicable payment terms." },
        { q: "Will I receive a booking confirmation?", a: "After a successful reservation, Drivers should receive confirmation containing relevant booking information. Always verify that your reservation has been successfully confirmed before relying on the parking space." },
      ]},
      { sub: "Your Account", items: [
        { q: "Do I need a ParkShare account?", a: "Certain ParkShare features, including making reservations and managing listings, may require an account." },
        { q: "What if I forget my password?", a: "Use the password recovery option on the sign-in screen and follow the instructions provided." },
        { q: "How do I update my information?", a: "Account information can be managed through the options available within your ParkShare account." },
      ]},
    ],
  },
  {
    id: "trust", icon: "🛡️", title: "Trust & Safety",
    groups: [
      { sub: "A Community Built on Trust", items: [
        { q: "How does ParkShare promote safe, reliable experiences?", a: "ParkShare is building its marketplace around transparency, accurate listings, accountability and respect between Hosts and Drivers. Everyone using ParkShare is expected to follow applicable ParkShare policies and treat people and property respectfully." },
        { q: "What information should Hosts provide?", a: "Hosts should provide accurate photographs, parking instructions, availability, restrictions and other information Drivers reasonably need to understand the space they're booking." },
        { q: "What are Drivers responsible for?", a: "Drivers should park only in their reserved space, follow applicable instructions, respect the property and leave within their confirmed reservation period." },
        { q: "What should I do if something goes wrong?", a: "Use ParkShare's available support options and provide the relevant reservation information along with a clear description of what happened. For emergencies or situations involving immediate personal safety, contact the appropriate local emergency or public safety service first." },
      ]},
    ],
  },
];

function HelpAccordionItem({ q, a, isOpen, onToggle }) {
  return (
    <div style={{ background: C.white, border: "1.5px solid " + C.concrete, borderRadius: 12, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "13px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, cursor: "pointer" }}
      >
        <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13, color: C.navy }}>{q}</span>
        <span style={{ fontSize: 15, color: C.amber, flexShrink: 0, transform: isOpen ? "rotate(45deg)" : "none", transition: "transform 0.15s" }}>+</span>
      </button>
      {isOpen && (
        <div style={{ padding: "0 14px 14px" }}>
          <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12.5, lineHeight: 1.65, color: "#333", margin: 0 }}>{a}</p>
        </div>
      )}
    </div>
  );
}

// ─── Help Centre — search up top, four category cards that jump to a
// section, and every question rendered as a collapsed accordion so the
// page doesn't feel enormous on mobile even though it holds ~40 answers.
// Parker gets the "customer care" headset pose here, extending his role
// as guide into support specifically.
// ─────────────────────────────────────────────────────────────────────────────
function HelpPage({ tab, onTabChange, onLogoClick, user, onShowAuth, onSignOut, onLegalClick, onContactClick, onTrustClick, onAboutClick, onHostClick, onDriverClick }) {
  const [query, setQuery] = useState("");
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const toggle = (key) => {
    setOpenKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Flattened search results across every category/group, tagged with
  // which category they came from so results still make sense out of context.
  const searchResults = searching
    ? HELP_DATA.flatMap(cat =>
        cat.groups.flatMap((grp, gi) =>
          grp.items
            .map((item, ii) => ({ ...item, key: cat.id + "-" + gi + "-" + ii, catTitle: cat.title, catIcon: cat.icon }))
            .filter(item => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q))
        )
      )
    : [];

  return (
    <div style={{ minHeight: "100vh", background: C.warmWhite }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');`}</style>
      <Header tab={tab} onTabChange={onTabChange} onLogoClick={onLogoClick} user={user} onShowAuth={onShowAuth} onSignOut={onSignOut} />

      {/* Hero + search */}
      <div style={{ maxWidth: 460, margin: "0 auto", background: C.navy, padding: "30px 24px 26px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11, color: C.amber, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>ParkShare Help Centre</div>
        <h1 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 23, color: C.white, margin: "0 0 16px" }}>How can we help?</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: C.white, borderRadius: 12, padding: "12px 14px" }}>
          <span style={{ fontSize: 16 }}>🔍</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search ParkShare Help..."
            style={{ flex: 1, border: "none", outline: "none", fontFamily: "'Poppins', sans-serif", fontSize: 13.5, color: C.navy, background: "transparent" }}
          />
        </div>
      </div>

      <div style={{ maxWidth: 460, margin: "0 auto", padding: "22px 24px 0", fontFamily: "'Poppins', sans-serif" }}>

        {searching ? (
          /* Search mode — flat, filtered results only */
          <div style={{ marginBottom: 28 }}>
            <p style={{ fontSize: 12.5, color: C.muted, fontWeight: 600, margin: "0 0 12px" }}>
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{query}"
            </p>
            {searchResults.length === 0 ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <p style={{ fontSize: 13.5, color: C.muted, marginBottom: 12 }}>Parker couldn't find an answer for that.</p>
                <button onClick={onContactClick} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 10, padding: "10px 20px", fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Contact Support</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {searchResults.map(item => (
                  <div key={item.key}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, marginLeft: 2 }}>{item.catIcon} {item.catTitle}</div>
                    <HelpAccordionItem q={item.q} a={item.a} isOpen={openKeys.has(item.key)} onToggle={() => toggle(item.key)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Category cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 }}>
              {HELP_DATA.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => scrollTo(cat.id)}
                  style={{ background: C.white, border: "2px solid " + C.navy, borderRadius: 16, padding: "18px 12px", textAlign: "center", cursor: "pointer" }}
                >
                  <div style={{ fontSize: 26, marginBottom: 8 }}>{cat.icon}</div>
                  <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 12.5, color: C.navy, lineHeight: 1.3 }}>{cat.title}</div>
                </button>
              ))}
            </div>

            {/* Parker, in his customer-care role */}
            <div style={{ marginBottom: 28 }}>
              <ParkerTip pose="thinking">
                Tap a topic above, search up top, or scroll down — I've grouped every answer by who's asking.
              </ParkerTip>
            </div>

            {/* Full accordion content, grouped by category */}
            {HELP_DATA.map(cat => (
              <section key={cat.id} id={cat.id} style={{ scrollMarginTop: 20, marginBottom: 32 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>{cat.icon}</span>
                  <h2 style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, fontSize: 18, color: C.navy, margin: 0 }}>{cat.title}</h2>
                </div>
                {cat.groups.map((grp, gi) => (
                  <div key={gi} style={{ marginBottom: 16 }}>
                    <div style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 11.5, color: C.amber, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>{grp.sub}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {grp.items.map((item, ii) => {
                        const key = cat.id + "-" + gi + "-" + ii;
                        return <HelpAccordionItem key={key} q={item.q} a={item.a} isOpen={openKeys.has(key)} onToggle={() => toggle(key)} />;
                      })}
                    </div>
                  </div>
                ))}
                {cat.id === "trust" && (
                  <button onClick={onTrustClick} style={{ background: "none", border: "none", padding: 0, color: C.moss, textDecoration: "underline", fontFamily: "'Poppins', sans-serif", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Learn More About Trust &amp; Safety →</button>
                )}
              </section>
            ))}
          </>
        )}

        {/* Still Need Help? */}
        <section style={{ marginBottom: 28, background: C.navy, borderRadius: 16, padding: "22px 20px", textAlign: "center" }}>
          <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 15, color: C.white, margin: "0 0 4px" }}>Parker couldn't find the answer?</p>
          <p style={{ fontFamily: "'Poppins', sans-serif", fontSize: 12.5, color: "rgba(255,255,255,0.75)", margin: "0 0 16px", lineHeight: 1.6 }}>
            Sometimes you just need to talk to someone. Tell us how we can help, and provide your account info and reservation number where applicable.
          </p>
          <button onClick={onContactClick} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 12, padding: "12px 24px", fontFamily: "'Poppins', sans-serif", fontSize: 13.5, fontWeight: 700, cursor: "pointer", width: "100%" }}>Contact ParkShare Support</button>
        </section>

        {/* Closing */}
        <section style={{ textAlign: "center", marginBottom: 28 }}>
          <p style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 15, color: C.navy, margin: "0 0 20px" }}>Parking should be simple.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={onDriverClick} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 12, padding: "14px 26px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Find Parking</button>
            <button onClick={onHostClick} style={{ background: C.navy, color: C.white, border: "none", borderRadius: 12, padding: "14px 26px", fontFamily: "'Poppins', sans-serif", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Become a Host</button>
          </div>
        </section>
      </div>

      <Footer onLegalClick={onLegalClick} onContactClick={onContactClick} onTrustClick={onTrustClick} onAboutClick={onAboutClick} onHelpClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); }} />
    </div>
  );
}

function ContactPage({ tab, onTabChange, onLogoClick, user, onShowAuth, onSignOut, onLegalClick, onContactClick, onTrustClick, onAboutClick, onHelpClick }) {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [errors, setErrors] = useState({});
  const [sent, setSent] = useState(false);

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = "Please enter your name";
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Please enter a valid email";
    if (!form.message.trim()) errs.message = "Please enter a message";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    // TODO: wire this up to a real backend before launch — e.g. a Supabase
    // Edge Function, Formspree endpoint, or EmailJS call that sends the
    // submission to Support@myparkshare.ca. For now this just opens a
    // pre-filled email as a working fallback so the form isn't a dead end.
    const mailBody = encodeURIComponent(`${form.message}\n\n— ${form.name} (${form.email})`);
    const mailSubject = encodeURIComponent(form.subject || "ParkShare Contact Form");
    window.location.href = `mailto:Support@myparkshare.ca?subject=${mailSubject}&body=${mailBody}`;
    setSent(true);
  };

  const pillBtnStyle = { background: C.amber, color: C.navy, border: "2px solid " + C.navy, boxShadow: "0 0 0 2px " + C.white, borderRadius: 10, padding: "12px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Poppins', sans-serif" };

  return (
    <div style={{ minHeight: "100vh", background: C.warmWhite }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');`}</style>
      <Header tab={tab} onTabChange={onTabChange} onLogoClick={onLogoClick} user={user} onShowAuth={onShowAuth} onSignOut={onSignOut} />

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "28px 20px 60px", fontFamily: "'Poppins', sans-serif" }}>

        <div style={{ background: C.white, border: "2px solid " + C.navy, boxShadow: "0 0 0 2px " + C.white + ", 0 2px 10px rgba(28,43,57,0.08)", borderRadius: 14, padding: "18px 20px", marginBottom: 32 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: C.muted, fontWeight: 700, marginBottom: 10 }}>Reach us</div>
          <div style={{ fontSize: 14, color: C.navy, lineHeight: 1.8 }}>
            <div><strong>Email:</strong> <a href="mailto:Support@myparkshare.ca" style={{ color: C.moss, textDecoration: "underline" }}>Support@myparkshare.ca</a></div>
          </div>
        </div>

        <section style={{ marginBottom: 40 }}>
          <div style={{ color: C.amber, fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Get in touch</div>
          <div style={{ display: "inline-block", background: C.amber, color: C.navy, border: "2px solid " + C.navy, boxShadow: "0 0 0 2px " + C.white, borderRadius: 10, padding: "8px 18px", marginBottom: 4 }}>
            <h1 style={{ fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 24, margin: 0, lineHeight: 1.2 }}>Contact <span style={{ color: C.white }}>Us</span></h1>
          </div>
          <p style={{ color: C.muted, fontSize: 12.5, margin: "10px 0 20px" }}>Questions, feedback, or an issue with a booking — send it over and we'll get back to you.</p>

          {sent ? (
            <div style={{ background: C.mossLight, border: "2px solid " + C.moss, borderRadius: 12, padding: "20px", fontSize: 14, color: C.navy }}>
              Thanks, {form.name || "there"} — your email client should have opened with your message ready to send. If it didn't, email us directly at{" "}
              <a href="mailto:Support@myparkshare.ca" style={{ color: C.moss, textDecoration: "underline" }}>Support@myparkshare.ca</a>.
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ background: C.white, border: "1px solid " + C.concrete, borderRadius: 14, padding: "22px 20px" }}>
              <ContactField label="Name" name="name" value={form.name} onChange={handleChange} error={errors.name} />
              <ContactField label="Email" name="email" type="email" value={form.email} onChange={handleChange} error={errors.email} />
              <ContactField label="Subject" name="subject" value={form.subject} onChange={handleChange} />
              <ContactField label="Message" name="message" value={form.message} onChange={handleChange} textarea error={errors.message} />
              <button type="submit" style={pillBtnStyle}>Send Message</button>
            </form>
          )}
        </section>
      </div>

      <Footer onLegalClick={onLegalClick} onContactClick={() => { window.scrollTo({ top: 0, behavior: "smooth" }); }} onTrustClick={onTrustClick} onAboutClick={onAboutClick} onHelpClick={onHelpClick} />
    </div>
  );
}

// ─── Extend Session ───────────────────────────────────────────────────────────
// Opened either from an "Add Additional Time" email link (via ?extend_booking=
// in the URL, handled in App() below) or from an in-app "Add time" action
// wired up the same way. Only needs a bookingId — everything else (listing,
// current end time, price) is looked up server-side in create-extend-session.js,
// same division of responsibility as the original PaymentModal/checkout flow.
function ExtendSessionModal({ bookingId, onClose }) {
  const [addedHours, setAddedHours] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const options = [
    { hours: 0.5, label: "+30 min" },
    { hours: 1, label: "+1 hr" },
    { hours: 2, label: "+2 hrs" },
    { hours: 4, label: "+4 hrs" },
  ];

  const extend = async () => {
    setError("");
    setLoading(true);
    try {
      // Same auth pattern as payWithStripe() in PaymentModal — send the
      // current Supabase JWT so the server can verify who's asking, and
      // that they actually own this booking.
      let { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      let session = sessionData?.session;

      if (sessionError || !session?.access_token) {
        const { data: refreshedData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) throw refreshError;
        session = refreshedData?.session;
      }
      if (!session?.access_token) {
        throw new Error("Your session is invalid or expired. Please sign in again.");
      }

      const res = await fetch("/api/create-extend-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ bookingId: Number(bookingId), addedHours }),
      });

      let data = {};
      try { data = await res.json(); } catch { /* fall through to the generic error below */ }

      if (res.status === 401) {
        throw new Error("Your session is invalid or expired. Please sign out and sign in again.");
      }
      if (!res.ok) {
        throw new Error(data.error || "Couldn't start checkout. Please try again.");
      }
      if (!data.url) {
        throw new Error("Stripe checkout did not return a payment link.");
      }

      window.location.assign(data.url); // hand off to Stripe's hosted checkout page
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setLoading(false);
    }
  };

  return (
    <Modal title="Add Additional Time" onClose={onClose}>
      <p style={{ fontSize: 13, color: C.muted, marginTop: -4, marginBottom: 16 }}>
        Extend your current session. You'll be charged the listing's current rate for the extra time.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {options.map(opt => (
          <button
            key={opt.hours}
            onClick={() => setAddedHours(opt.hours)}
            disabled={loading}
            style={{
              flex: "1 1 70px", padding: "10px 8px", borderRadius: 8,
              cursor: loading ? "default" : "pointer",
              border: addedHours === opt.hours ? "2px solid " + C.amber : "1.5px solid " + C.concrete,
              background: addedHours === opt.hours ? C.amberLight : C.white,
              fontWeight: 700, fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 13,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {error && <p style={{ color: C.red, fontSize: 12, marginBottom: 14, lineHeight: 1.4 }}>{error}</p>}
      <Btn variant="amber" full onClick={extend} disabled={loading}>
        {loading ? "Starting checkout…" : "Extend & pay →"}
      </Btn>
    </Modal>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("landing"); // "landing" | "app" — landing shows first on every fresh visit
  const [tab, setTab] = useState("Browse");
  const [messageThread, setMessageThread] = useState(null);
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [browseKey, setBrowseKey] = useState(0);
  const [checkoutBanner, setCheckoutBanner] = useState(null); // "success" | "cancelled" | null
  const [connectBanner, setConnectBanner] = useState(null); // "success" | "refresh" | null
  const [extendBookingId, setExtendBookingId] = useState(null); // set when arriving via an "Add Additional Time" email link
  const [viewBookingId, setViewBookingId] = useState(null); // set when arriving via a "View My Reservation" email link
  const [browseAutoFocus, setBrowseAutoFocus] = useState(false);
  const [browseAutoLocate, setBrowseAutoLocate] = useState(false);
  const [browseInitialLocation, setBrowseInitialLocation] = useState(null);
  const [browseInitialQuery, setBrowseInitialQuery] = useState("");

  // Detect returning from Stripe's hosted checkout page and show a banner,
  // then strip the query params so refreshing doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("booking_success")) {
      setCheckoutBanner("success");
      setTab("My Bookings");
    } else if (params.has("booking_cancelled")) {
      setCheckoutBanner("cancelled");
    } else if (params.get("stripe_onboarding") === "return") {
      // Stripe's account_onboarding return_url (set in api/connect-onboarding.js)
      // — the account.updated webhook may take a few seconds to land, but
      // HostDashboard re-reads the profile on mount so it'll pick up the
      // latest status shortly after.
      setConnectBanner("success");
      setTab("Host Dashboard");
    } else if (params.get("stripe_onboarding") === "refresh") {
      // Stripe's refresh_url — the onboarding link expired or was abandoned;
      // send them back to the dashboard so they can restart it.
      setConnectBanner("refresh");
      setTab("Host Dashboard");
    } else if (params.get("extend_booking")) {
      // Arrived via the "Add Additional Time" link in a reminder email
      // (see EXTEND_URL in send-reminders.js / _email.js). Opens the modal
      // directly rather than routing through "My Bookings," since the
      // renter is coming from a specific email about a specific booking.
      setExtendBookingId(params.get("extend_booking"));
    } else if (params.get("view_booking")) {
      // Arrived via "View My Reservation" (MANAGE_RESERVATION_URL) in a
      // confirmation/reminder email. Unlike extend_booking, there's no
      // dedicated single-booking page — this app doesn't have per-booking
      // routes — so it lands on "My Bookings" and scrolls to/highlights
      // the specific booking instead of just dropping them on the
      // unfiltered list to go find it themselves.
      setTab("My Bookings");
      setViewBookingId(params.get("view_booking"));
    }
    if (params.has("booking_success") || params.has("booking_cancelled") || params.has("stripe_onboarding") || params.has("extend_booking") || params.has("view_booking")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleAuth = (u) => {
    setUser(u);
    setTab(u.role === "host" ? "Host Dashboard" : "Browse");
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setTab("Browse");
  };

  // Restore session on page load / refresh, and react to future sign-outs
  // (e.g. token expiry) from anywhere in the app.
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session || !active) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();
      if (profile && active) {
        setUser({ id: profile.id, name: profile.name, email: profile.email, role: profile.role });
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setUser(null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const goHome = () => { setScreen("landing"); setTab("Browse"); setBrowseKey(k => k + 1); };
  const openLegal = () => setScreen("legal");
  const openContact = () => setScreen("contact");
  const openTrust = () => setScreen("trust");
  const openHost = () => setScreen("host");
  const openDriver = () => setScreen("driver");
  const openAbout = () => setScreen("about");
  const openHelp = () => setScreen("help");
  // Shared by both the landing page's header and the main app header — tapping
  // any nav tab always exits landing mode (harmless no-op if already in the app).
  const changeTab = (t) => { setScreen("app"); setTab(t); };

  const requireAuth = (content, msg) => {
    if (!user) return (
      <div style={{ padding: "60px 24px", textAlign: "center", fontFamily: "'Poppins', sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <img src={PARKER.welcome} alt="Parker waving hello" style={{ height: 100, width: "auto", marginBottom: 10 }} />
        </div>
        <h3 style={{ fontFamily: "'Poppins', sans-serif", color: C.navy, fontSize: 20, marginBottom: 8 }}>Sign in required</h3>
        <p style={{ color: C.muted, fontSize: 14, marginBottom: 24 }}>{msg || "You need an account to access this."}</p>
        <button onClick={() => setShowAuth(true)} style={{ background: C.amber, color: C.navy, border: "none", borderRadius: 12, padding: "12px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Sign in / Join free</button>
      </div>
    );
    return content;
  };

  // Landing-page actions route straight into the real app logic —
  // no duplicated search/geolocation code, just a different entry point.
  const enterApp = (nextTab) => { setScreen("app"); if (nextTab) setTab(nextTab); };
  const handleLandingSearch = (suggestion, typedQuery) => {
    setBrowseAutoLocate(false);
    if (suggestion) {
      // A specific address was picked from the landing page's autocomplete —
      // carry its exact coordinates into the Browse map.
      setBrowseInitialLocation({ lat: suggestion.lat, lng: suggestion.lng });
      setBrowseInitialQuery(suggestion.short);
      setBrowseAutoFocus(false);
    } else {
      // No suggestion picked — just carry over whatever text was typed, if any.
      setBrowseInitialLocation(null);
      setBrowseInitialQuery(typedQuery || "");
      setBrowseAutoFocus(!typedQuery);
    }
    enterApp("Browse");
  };
  const handleLandingLocation = () => { setBrowseAutoFocus(false); setBrowseAutoLocate(true); enterApp("Browse"); };
  // Host page CTA: straight into the listing flow if already signed in,
  // otherwise open sign-up first (role selection happens in that flow).
  const handleHostGetStarted = () => { if (user) enterApp("List Your Driveway"); else setShowAuth(true); };
  // Driver page CTA: Browse doesn't require sign-in, so this can go straight in.
  const handleFindParking = () => { setBrowseAutoFocus(false); setBrowseAutoLocate(false); enterApp("Browse"); };

  return (
    <>
      {screen === "landing" ? (
        <LandingPage
          onSearchAddress={handleLandingSearch}
          onUseLocation={handleLandingLocation}
          tab={tab}
          onTabChange={changeTab}
          onLogoClick={goHome}
          user={user}
          onShowAuth={() => setShowAuth(true)}
          onSignOut={handleSignOut}
          onLegalClick={openLegal}
          onContactClick={openContact}
          onTrustClick={openTrust}
          onHostClick={openHost}
          onDriverClick={openDriver}
          onAboutClick={openAbout}
          onHelpClick={openHelp}
        />
      ) : screen === "legal" ? (
        <LegalPage
          tab={tab}
          onTabChange={changeTab}
          onLogoClick={goHome}
          user={user}
          onShowAuth={() => setShowAuth(true)}
          onSignOut={handleSignOut}
          onContactClick={openContact}
          onTrustClick={openTrust}
          onAboutClick={openAbout}
          onHelpClick={openHelp}
        />
      ) : screen === "trust" ? (
        <TrustPage
          tab={tab}
          onTabChange={changeTab}
          onLogoClick={goHome}
          user={user}
          onShowAuth={() => setShowAuth(true)}
          onSignOut={handleSignOut}
          onLegalClick={openLegal}
          onContactClick={openContact}
          onAboutClick={openAbout}
          onHostClick={openHost}
          onDriverClick={openDriver}
          onHelpClick={openHelp}
        />
      ) : screen === "about" ? (
        <AboutPage
          tab={tab}
          onTabChange={changeTab}
          onLogoClick={goHome}
          user={user}
          onShowAuth={() => setShowAuth(true)}
          onSignOut={handleSignOut}
          onLegalClick={openLegal}
          onContactClick={openContact}
          onTrustClick={openTrust}
          onHostClick={openHost}
          onDriverClick={openDriver}
          onHelpClick={openHelp}
        />
      ) : screen === "help" ? (
        <HelpPage
          tab={tab}
          onTabChange={changeTab}
          onLogoClick={goHome}
          user={user}
          onShowAuth={() => setShowAuth(true)}
          onSignOut={handleSignOut}
          onLegalClick={openLegal}
          onContactClick={openContact}
          onTrustClick={openTrust}
          onAboutClick={openAbout}
          onHostClick={openHost}
          onDriverClick={openDriver}
        />
      ) : screen === "host" ? (
        <HostPage
          tab={tab}
          onTabChange={changeTab}
          onLogoClick={goHome}
          user={user}
          onShowAuth={() => setShowAuth(true)}
          onSignOut={handleSignOut}
          onLegalClick={openLegal}
          onContactClick={openContact}
          onTrustClick={openTrust}
          onGetStarted={handleHostGetStarted}
          onAboutClick={openAbout}
          onHelpClick={openHelp}
        />
      ) : screen === "driver" ? (
        <DriverPage
          tab={tab}
          onTabChange={changeTab}
          onLogoClick={goHome}
          user={user}
          onShowAuth={() => setShowAuth(true)}
          onSignOut={handleSignOut}
          onLegalClick={openLegal}
          onContactClick={openContact}
          onTrustClick={openTrust}
          onFindParking={handleFindParking}
          onAboutClick={openAbout}
          onHostClick={openHost}
          onHelpClick={openHelp}
        />
      ) : screen === "contact" ? (
        <ContactPage
          tab={tab}
          onTabChange={changeTab}
          onLogoClick={goHome}
          user={user}
          onShowAuth={() => setShowAuth(true)}
          onSignOut={handleSignOut}
          onLegalClick={openLegal}
          onTrustClick={openTrust}
          onAboutClick={openAbout}
          onHelpClick={openHelp}
        />
      ) : (
        <div style={{ minHeight: "100vh", background: C.warmWhite }}>
          <style>{`@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');`}</style>
          <Header tab={tab} onTabChange={changeTab} onLogoClick={goHome} user={user} onShowAuth={() => setShowAuth(true)} onSignOut={handleSignOut} />
          {checkoutBanner === "success" && (
            <div style={{ background: C.mossLight, borderBottom: "1px solid "+C.moss, color: C.moss, fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13, textAlign: "center", padding: "10px 16px", display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
              <span>🎉 Payment received — your booking is confirmed! It'll show up below in a moment.</span>
              <button onClick={() => setCheckoutBanner(null)} style={{ background: "none", border: "none", color: C.moss, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
          )}
          {checkoutBanner === "cancelled" && (
            <div style={{ background: C.amberLight, borderBottom: "1px solid "+C.amber, color: C.navy, fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13, textAlign: "center", padding: "10px 16px", display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
              <span>Checkout was cancelled — no charge was made.</span>
              <button onClick={() => setCheckoutBanner(null)} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
          )}
          {connectBanner === "success" && (
            <div style={{ background: C.mossLight, borderBottom: "1px solid "+C.moss, color: C.moss, fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13, textAlign: "center", padding: "10px 16px", display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
              <span>🎉 Stripe account connected! It may take a moment to finish verifying.</span>
              <button onClick={() => setConnectBanner(null)} style={{ background: "none", border: "none", color: C.moss, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
          )}
          {connectBanner === "refresh" && (
            <div style={{ background: C.amberLight, borderBottom: "1px solid "+C.amber, color: C.navy, fontFamily: "'Poppins', sans-serif", fontWeight: 700, fontSize: 13, textAlign: "center", padding: "10px 16px", display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
              <span>That Stripe setup link expired — tap "Connect with Stripe" below to try again.</span>
              <button onClick={() => setConnectBanner(null)} style={{ background: "none", border: "none", color: C.navy, fontWeight: 700, cursor: "pointer" }}>✕</button>
            </div>
          )}
          {tab === "Browse" && <BrowseView key={browseKey} onMessage={setMessageThread} user={user} autoFocusSearch={browseAutoFocus} autoLocate={browseAutoLocate} initialLocation={browseInitialLocation} initialQuery={browseInitialQuery} />}
          {tab === "Messages" && requireAuth(<MessagesView onOpenThread={setMessageThread} user={user} />, "Sign in to view your messages.")}
          {tab === "List Your Driveway" && <ListDrivewayView user={user} />}
          {tab === "My Bookings" && requireAuth(<MyBookingsView onMessage={setMessageThread} user={user} highlightBookingId={viewBookingId} />, "Sign in to view your bookings.")}
          {tab === "Host Dashboard" && requireAuth(<HostDashboard user={user} setTab={setTab} />, "Sign in to access your host dashboard.")}
          {tab === "Transactions" && requireAuth(<TransactionsView user={user} />, "Sign in to view your transactions.")}
          {messageThread && <MessagingPanel listing={messageThread} onClose={() => setMessageThread(null)} user={user} />}
          <FloatingParkerHelp />
          <Footer onLegalClick={openLegal} onContactClick={openContact} onTrustClick={openTrust} onAboutClick={openAbout} onHelpClick={openHelp} />
        </div>
      )}
      {showAuth && <SignInModal onClose={() => setShowAuth(false)} onAuth={handleAuth} />}
      {extendBookingId && (
        user ? (
          <ExtendSessionModal bookingId={extendBookingId} onClose={() => setExtendBookingId(null)} />
        ) : (
          // Arrived from an email link while signed out — ask them to sign
          // in first, then hand straight back to the extend modal rather
          // than losing which booking they clicked through for.
          <SignInModal onClose={() => setExtendBookingId(null)} onAuth={(u) => { handleAuth(u); }} />
        )
      )}
    </>
  );
}







