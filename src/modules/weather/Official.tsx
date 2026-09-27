import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Landmark,
  RefreshCw,
  Waves,
} from "lucide-react";
import { dateTime, time } from "../../../shared/journal";
import { ALERT_LABELS } from "../../../shared/ops";
import { enumLabel } from "../../../shared/i18n/enums.ts";
import { formatDate, getLang } from "../../../shared/i18n/core.ts";
import {
  OFFICIAL_PAGES,
  OfficialError,
  freshness,
  highlights,
  samePlace,
  stationPageUrl,
  trendOf,
  type Lang,
  type Level,
  type OfficialWarning,
  type Place,
  type Snapshot,
  type StationReading,
  type Trend,
} from "../../../shared/official.ts";
import {
  applyHydroThresholds,
  isHydroMetric,
  type HydroReading,
} from "../../../shared/thresholds";
import { useApp } from "../../app/context";
import { useLang } from "../../i18n";
import { fetchOfficial, readOfficial } from "./officialData";
import { round } from "./forecast";
import { t, tn } from "./i18n.ts";

/* ---------- State ---------- */

export type OfficialState = {
  snapshot: Snapshot | null;
  loading: boolean;
  /** Calm message of the last failure, or "". */
  error: string;
  refresh: () => Promise<void>;
};

const failureText = (err: unknown) =>
  err instanceof OfficialError && err.code === "offline"
    ? t("Hors ligne : les dernières données officielles restent affichées.")
    : t(
        "Les services officiels ne répondent pas pour le moment. Les dernières données restent affichées ; réessayez plus tard.",
      );

/**
 * Official warnings and water levels of the weather place, kept on this
 * device. Loaded only by `refresh` (a click, or the automatic refresh the
 * operator switched on); discharge and water level thresholds are then
 * compared with the measurements.
 */
export function useOfficial(place: Place | null): OfficialState {
  const { journal, live, readOnly, author, changeJournal, toast } = useApp();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() =>
    readOfficial(journal.id),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setSnapshot(readOfficial(journal.id));
    setError("");
  }, [journal.id]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const busy = useRef(false);
  const latest = useRef({ live, readOnly, author, changeJournal, toast });
  latest.current = { live, readOnly, author, changeJournal, toast };

  const refresh = useCallback(async () => {
    if (!place || busy.current) return;
    const journalId = journal.id;
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await fetchOfficial(journalId, place);
      if (!mounted.current) return;
      setSnapshot(result);
      if (result.failed.length)
        setError(
          t(
            "Une partie des données officielles n’a pas pu être chargée : les dernières reçues restent affichées.",
          ),
        );
      // Discharge and water level thresholds of the journal.
      const { live: j, readOnly: ro, author: by } = latest.current;
      if (
        ro ||
        j.id !== journalId ||
        !j.ops.thresholds.some((th) => th.active && isHydroMetric(th.metric))
      )
        return;
      const readings: HydroReading[] = result.stations
        .filter((s) => s.at !== null)
        .map((s) => ({
          station: s.id,
          name: stationName(s),
          at: s.at as number,
          discharge: s.discharge,
          waterLevel: s.waterLevel,
        }));
      const at = Date.now();
      const check = applyHydroThresholds(j, readings, by, at);
      if (!check.created.length && !check.extended) return;
      latest.current.changeJournal(
        (x) => applyHydroThresholds(x, readings, by, at).journal,
      );
      if (check.created.length)
        latest.current.toast(
          tn(
            check.created.length,
            "Seuil de cours d’eau franchi : alerte créée dans Météo.",
            "{n} seuils de cours d’eau franchis : alertes créées dans Météo.",
          ),
        );
    } catch (err) {
      if (mounted.current) setError(failureText(err));
    } finally {
      busy.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [journal.id, place]);

  return { snapshot, loading, error, refresh };
}

/* ---------- Wording ---------- */

export const stationName = (s: Pick<StationReading, "water" | "place">) =>
  s.place ? `${s.water} · ${s.place}` : s.water;

/** "il y a 12 min", in the language of the post. */
export function ago(minutes: number) {
  if (minutes < 1) return t("à l’instant");
  if (minutes < 60) return t("il y a {n} min", { n: minutes });
  if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? t("il y a {h} h {m} min", { h, m }) : t("il y a {h} h", { h });
  }
  return t("il y a {n} jours", { n: Math.floor(minutes / 1440) });
}

const levelText = (level: Level) =>
  level
    ? enumLabel(ALERT_LABELS[String(level) as "1"])
    : t("Pas de degré publié");

const hazardOf = (w: OfficialWarning) =>
  w.source === "fire"
    ? t("Incendies de forêt")
    : w.kind === "region"
      ? t("Crues (région)")
      : w.kind === "lake"
        ? t("Crues (lac)")
        : t("Crues (cours d’eau)");

function LevelBadge({ level }: { level: Level }) {
  return (
    <span className={`weather-level lvl-${level || 1} ${level ? "" : "none"}`}>
      <span className="sr-only">{t("Degré")} </span>
      {level || "–"}
    </span>
  );
}

function TrendText({ trend, unit }: { trend: Trend | null; unit: string }) {
  if (!trend) return null;
  const Icon =
    trend.direction === "up"
      ? ArrowUpRight
      : trend.direction === "down"
        ? ArrowDownRight
        : ArrowRight;
  const change = `${trend.delta > 0 ? "+" : ""}${round(trend.delta, unit === "m" ? 2 : 1)} ${unit}`;
  return (
    <span className={`official-trend ${trend.direction}`}>
      <Icon size={13} aria-hidden="true" />
      {trend.direction === "up"
        ? t("en hausse ({change} en {minutes} min)", {
            change,
            minutes: trend.minutes,
          })
        : trend.direction === "down"
          ? t("en baisse ({change} en {minutes} min)", {
              change,
              minutes: trend.minutes,
            })
          : t("stable (depuis {minutes} min)", { minutes: trend.minutes })}
    </span>
  );
}

/* ---------- Weather module card ---------- */

export function OfficialCard({
  state,
  place,
  archived,
}: {
  state: OfficialState;
  place: Place;
  /** Time machine or an older forecast shown: the card says it is current. */
  archived: boolean;
}) {
  const { now } = useApp();
  useLang();
  const lang = getLang() as Lang;
  const pages = OFFICIAL_PAGES[lang];
  const { snapshot: raw, loading, error, refresh } = state;
  const snapshot = raw && samePlace(raw.place, place) ? raw : null;
  const fresh = snapshot
    ? freshness(
        Math.max(
          snapshot.updated.flood ?? 0,
          snapshot.updated.fire ?? 0,
          snapshot.updated.stations ?? 0,
        ) || snapshot.fetchedAt,
        now,
      )
    : null;
  const [notable, calm] = useMemo(() => {
    const list = snapshot?.warnings ?? [];
    return [list.filter((w) => w.level >= 2), list.filter((w) => w.level < 2)];
  }, [snapshot]);

  return (
    <section
      className="card w-12 official"
      aria-label={t("Alertes officielles et cours d’eau")}
    >
      <div className="card-head">
        <Landmark size={15} />
        <h2>{t("Alertes officielles et cours d’eau")}</h2>
        <button
          className="small"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw size={13} className={loading ? "weather-spin" : ""} />
          {loading ? t("Chargement…") : t("Actualiser")}
        </button>
      </div>

      <div className="official-status">
        {snapshot && fresh ? (
          <span
            className={`pill ${fresh.state === "fresh" ? "ok" : fresh.state === "aging" ? "warn" : "crit"}`}
          >
            {t("Dernière mise à jour {ago}", { ago: ago(fresh.minutes) })}
          </span>
        ) : (
          <span className="pill muted">{t("Pas encore chargé")}</span>
        )}
        {fresh?.state === "stale" && (
          <span className="muted">
            {t("Données anciennes : actualisez avant de décider.")}
          </span>
        )}
        {archived && (
          <span className="muted">
            {t("Données actuelles, pas celles de l’heure affichée.")}
          </span>
        )}
      </div>
      {error && (
        <p className="official-calm" role="status">
          {error}
        </p>
      )}

      {!snapshot ? (
        <div className="official-empty">
          <p>
            {t(
              "Degrés de danger officiels (crues, incendies de forêt) et niveau des cours d’eau les plus proches, publiés par l’OFEV et les cantons. Chargés uniquement quand vous le demandez.",
            )}
          </p>
          <button
            className="primary"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "weather-spin" : ""} />
            {t("Charger les alertes officielles")}
          </button>
        </div>
      ) : (
        <>
          {notable.length > 0 && (
            <div className="weather-alert-list official-list">
              {notable.map((w) => (
                <WarningRow key={w.key} w={w} />
              ))}
            </div>
          )}
          {calm.length > 0 && (
            <p className="official-calm-levels">
              <LevelBadge level={1} />
              <span>
                <strong>{levelText(1)}</strong>
                <small>
                  {[...new Set(calm.map((w) => w.name).filter(Boolean))].join(
                    " · ",
                  )}
                </small>
              </span>
            </p>
          )}
          {!notable.length &&
            !calm.length &&
            !snapshot.failed.includes("flood") && (
              <p className="muted">
                {t("Aucun degré de danger officiel publié pour ce lieu.")}
              </p>
            )}
          {snapshot.failed.includes("flood") && (
            <p className="official-calm">
              {t(
                "Carte des crues : pas de réponse, les dernières données reçues sont gardées.",
              )}
            </p>
          )}
          {snapshot.failed.includes("fire") && (
            <p className="official-calm">
              {t(
                "Danger d’incendie : pas de réponse, les dernières données reçues sont gardées.",
              )}
            </p>
          )}

          <h3 className="official-sub">
            <Waves size={14} />
            {t("Cours d’eau les plus proches")}
          </h3>
          {snapshot.stations.length ? (
            <div className="official-stations">
              {snapshot.stations.map((s) => (
                <StationRow
                  key={s.id}
                  s={s}
                  history={snapshot.history[s.id]}
                  now={now}
                  lang={lang}
                />
              ))}
            </div>
          ) : (
            <p className="muted">
              {snapshot.failed.includes("stations")
                ? t(
                    "Stations de mesure : pas de réponse pour le moment. Réessayez plus tard.",
                  )
                : t(
                    "Aucune station de mesure fédérale à moins de 25 km de ce lieu.",
                  )}
            </p>
          )}
        </>
      )}

      <div className="official-meteoswiss">
        <p>
          <strong>{t("Alertes météo de MétéoSuisse")}</strong>
          <small>
            {t(
              "Orages, pluie, vent, neige, chaleur, gel : MétéoSuisse ne les publie pas encore en données ouvertes. Consultez-les sur le site officiel.",
            )}
          </small>
        </p>
        <a
          className="button"
          href={pages.meteoswiss}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} />
          {t("Alertes MétéoSuisse")}
        </a>
        <a
          className="button"
          href={pages.hazards}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} />
          {t("Portail des dangers naturels")}
        </a>
      </div>
      <p className="weather-privacy">
        {t(
          "Ce sont les degrés officiels de l’OFEV et des cantons, repris tels quels ; MétéoSuisse et l’OFEV restent la référence. Pour les charger, les coordonnées du lieu partent vers geo.admin.ch et les numéros des stations vers admin.ch (LINDAS), rien d’autre.",
        )}
      </p>
    </section>
  );
}

function WarningRow({ w }: { w: OfficialWarning }) {
  const lang = getLang() as Lang;
  return (
    <a
      className={`weather-alert active lvl-${w.level} official-row`}
      href={OFFICIAL_PAGES[lang].hazards}
      target="_blank"
      rel="noreferrer"
    >
      <LevelBadge level={w.level} />
      <span className="weather-alert-main">
        <strong>{levelText(w.level)}</strong>
        <span>
          {hazardOf(w)}
          {w.name && ` · ${w.name}`}
        </span>
        <small>
          {[
            w.text && `« ${w.text} »`,
            w.validFrom &&
              t("en vigueur depuis le {date}", {
                date: formatDate(w.validFrom),
              }),
            w.issuedAt && t("publié le {date}", { date: dateTime(w.issuedAt) }),
            w.source === "fire" ? t("cantons et OFEV") : t("OFEV"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </span>
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

function StationRow({
  s,
  history,
  now,
  lang,
}: {
  s: StationReading;
  history: Snapshot["history"][string] | undefined;
  now: number;
  lang: Lang;
}) {
  const age = s.at !== null ? freshness(s.at, now) : null;
  const discharge = trendOf(history, "discharge");
  const level = trendOf(history, "waterLevel");
  return (
    <div className={`official-station lvl-${s.level}`}>
      <LevelBadge level={s.level} />
      <div className="official-station-main">
        <strong>
          {stationName(s)}{" "}
          <small className="muted">
            {t("{km} km", { km: round(s.km, 1) })}
          </small>
        </strong>
        <span className="official-values">
          {s.discharge !== null && (
            <span>
              {t("Débit {value} m³/s", { value: round(s.discharge, 1) })}{" "}
              <TrendText trend={discharge} unit="m³/s" />
            </span>
          )}
          {s.waterLevel !== null && (
            <span>
              {t("Niveau {value} m", { value: round(s.waterLevel, 2) })}{" "}
              {s.discharge === null && <TrendText trend={level} unit="m" />}
            </span>
          )}
          {s.discharge === null && s.waterLevel === null && (
            <span className="muted">{t("Pas de mesure reçue")}</span>
          )}
        </span>
        <small>
          {[
            levelText(s.level),
            s.at !== null &&
              t("mesuré à {time} ({ago})", {
                time: time(new Date(s.at).toISOString()),
                ago: ago(age?.minutes ?? 0),
              }),
            t("station {id}", { id: s.id }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
        {age && age.state === "stale" && (
          <small className="official-old">
            {t("Mesure ancienne : vérifiez sur la page de l’OFEV.")}
          </small>
        )}
      </div>
      <a
        className="button small"
        href={stationPageUrl(s.id, lang)}
        target="_blank"
        rel="noreferrer"
        aria-label={t("Page officielle de la station {id}", { id: s.id })}
      >
        <ExternalLink size={13} />
        <span className="weather-hide-narrow">{t("OFEV")}</span>
      </a>
    </div>
  );
}

/* ---------- Situation page ---------- */

/**
 * Official levels from 3 (danger marqué) up, for the weather card of the
 * Situation page. Reads the copy kept on this device: nothing is loaded.
 */
export function OfficialChips({
  place,
  onOpen,
}: {
  place: Place | null;
  onOpen: () => void;
}) {
  const { journal, now, viewAt } = useApp();
  useLang();
  // Re-read the local copy with the 30-second clock.
  const snapshot = useMemo(() => readOfficial(journal.id), [journal.id, now]);
  if (viewAt !== null || !snapshot || !samePlace(snapshot.place, place))
    return null;
  const list = highlights(snapshot);
  if (!list.length) return null;
  const fresh = freshness(snapshot.fetchedAt, now);
  return (
    <div className="official-chips">
      {list.slice(0, 3).map((h) => (
        <button
          key={h.kind === "warning" ? h.warning.key : `station:${h.station.id}`}
          className={`weather-alert active lvl-${h.level} official-chip`}
          onClick={onOpen}
        >
          <LevelBadge level={h.level} />
          <span className="weather-alert-main">
            <strong>
              {h.kind === "warning"
                ? `${hazardOf(h.warning)}${h.warning.name ? ` · ${h.warning.name}` : ""}`
                : t("Cours d’eau · {name}", { name: stationName(h.station) })}
            </strong>
            <small>
              {[
                levelText(h.level),
                h.kind === "warning" && h.warning.validFrom
                  ? t("en vigueur depuis le {date}", {
                      date: formatDate(h.warning.validFrom),
                    })
                  : "",
                t("officiel, {ago}", { ago: ago(fresh.minutes) }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </span>
        </button>
      ))}
    </div>
  );
}
