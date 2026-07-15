import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Users,
  BookOpen,
  Plus,
  Search,
  X,
  Minus,
  Phone,
  Mail,
  UtensilsCrossed,
  MapPin,
  Clock,
} from "lucide-react";
import { getCalendarEvents, type CalendarReservation } from "@/lib/calendar.functions";

export const Route = createFileRoute("/")({
  component: BookingPage,
});


/* ─────────────── Types & data ─────────────── */

type Shift = "Breakfast" | "Lunch" | "Dinner";
type FloorType = "main" | "balcony" | "lounge" | "terrace";
type ReservationStatus = "confirmed" | "no-show" | "cancelled";
type ReservationSource = "phone" | "email" | "online" | "walk-in";

interface Reservation {
  id: string;
  dateISO: string;
  shift: Shift;
  timeLabel: string;
  guests: number;
  floor: FloorType;
  table: number;
  status: ReservationStatus;
  source: ReservationSource;
  guestName: string;
  phone: string;
  note?: string;
}

const toISODate = (d: Date) => d.toISOString().split("T")[0];
const fromISODate = (iso: string) => new Date(iso + "T00:00:00");
const addDays = (d: Date, n: number) =>
  new Date(d.getTime() + n * 86400000);
const startOfWeek = (d: Date) => {
  const day = d.getDay() || 7;
  return addDays(d, -day + 1);
};
const fmtDayNum = (d: Date) =>
  d.toLocaleDateString("en-US", { day: "numeric" });
const fmtMonth = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short" });
const dowShort = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "short" });
const dowLong = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "long" });

const shiftForHour = (h: number): Shift =>
  h < 12 ? "Breakfast" : h < 17 ? "Lunch" : "Dinner";

const FLOOR_TABLES: Record<FloorType, number[]> = {
  main: Array.from({ length: 14 }, (_, i) => i + 1),
  balcony: Array.from({ length: 8 }, (_, i) => i + 21),
  lounge: Array.from({ length: 6 }, (_, i) => i + 41),
  terrace: Array.from({ length: 10 }, (_, i) => i + 51),
};

const FLOOR_LABEL: Record<FloorType, string> = {
  main: "Main Floor",
  balcony: "Balcony",
  lounge: "Lounge",
  terrace: "Terrace",
};

const fromCalendarReservation = (c: CalendarReservation): Reservation => ({
  id: c.id,
  dateISO: c.dateISO,
  shift: c.shift,
  timeLabel: c.timeLabel,
  guests: c.guests,
  floor: c.floor,
  table: c.table || (FLOOR_TABLES[c.floor]?.[0] ?? 0),
  status: c.status,
  source: c.source,
  guestName: c.guestName,
  phone: c.phone,
  note: c.tags ? c.tags : c.note,
});

/* ─────────────── Page ─────────────── */

function BookingPage() {
  const today = new Date();
  const [activeDateISO, setActiveDateISO] = useState(toISODate(today));
  const [weekStartISO, setWeekStartISO] = useState(
    toISODate(startOfWeek(today)),
  );
  const [floor, setFloor] = useState<FloorType>("main");
  const [selectedTable, setSelectedTable] = useState<number | null>(null);
  const [localReservations, setLocalReservations] = useState<Reservation[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedReservationId, setSelectedReservationId] = useState<
    string | null
  >(null);

  const activeDate = fromISODate(activeDateISO);
  const weekStart = fromISODate(weekStartISO);

  // Query calendar events for the visible week (ms since epoch).
  const weekEndISO = toISODate(addDays(weekStart, 7));
  const startTimeMs = fromISODate(weekStartISO).getTime();
  const endTimeMs = fromISODate(weekEndISO).getTime();

  const eventsQuery = useQuery({
    queryKey: ["calendar-events", weekStartISO],
    queryFn: () =>
      getCalendarEvents({ data: { startTime: startTimeMs, endTime: endTimeMs } }),
    staleTime: 60_000,
  });

  const remoteReservations = useMemo<Reservation[]>(
    () => (eventsQuery.data || []).map(fromCalendarReservation),
    [eventsQuery.data],
  );

  const reservations = useMemo(
    () => [...remoteReservations, ...localReservations],
    [remoteReservations, localReservations],
  );


  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = addDays(weekStart, i);
        const iso = toISODate(d);
        const dayRes = reservations.filter((r) => r.dateISO === iso);
        return {
          iso,
          d,
          count: dayRes.length,
          people: dayRes.reduce((s, r) => s + r.guests, 0),
        };
      }),
    [weekStart, reservations],
  );

  const customersToday = useMemo(
    () =>
      reservations
        .filter((r) => r.dateISO === activeDateISO)
        .sort((a, b) => a.timeLabel.localeCompare(b.timeLabel)),
    [reservations, activeDateISO],
  );

  const byShift = useMemo(() => {
    const r: Record<Shift, { bookings: number; guests: number }> = {
      Breakfast: { bookings: 0, guests: 0 },
      Lunch: { bookings: 0, guests: 0 },
      Dinner: { bookings: 0, guests: 0 },
    };
    customersToday.forEach((x) => {
      r[x.shift].bookings++;
      r[x.shift].guests += x.guests;
    });
    return r;
  }, [customersToday]);

  const tablesForFloor = FLOOR_TABLES[floor];
  const tableMap = useMemo(() => {
    const m = new Map<number, Reservation>();
    reservations
      .filter((r) => r.dateISO === activeDateISO && r.floor === floor)
      .forEach((r) => m.set(r.table, r));
    return m;
  }, [reservations, activeDateISO, floor]);

  const handlePrevWeek = () => {
    const prev = addDays(weekStart, -7);
    setWeekStartISO(toISODate(prev));
    setActiveDateISO(toISODate(prev));
  };
  const handleNextWeek = () => {
    const next = addDays(weekStart, 7);
    setWeekStartISO(toISODate(next));
    setActiveDateISO(toISODate(next));
  };

  const addReservation = (r: Reservation) => {
    setLocalReservations((prev) => [...prev, r]);
    setActiveDateISO(r.dateISO);
    setFloor(r.floor);
  };

  return (
    <div className="min-h-screen text-foreground">
      <Header
        activeDate={activeDate}
        onNew={() => setModalOpen(true)}
        totalToday={customersToday.length}
        guestsToday={customersToday.reduce((s, r) => s + r.guests, 0)}
      />

      <WeekNav
        weekStart={weekStart}
        weekDays={weekDays}
        activeDateISO={activeDateISO}
        onPrev={handlePrevWeek}
        onNext={handleNextWeek}
        onPick={setActiveDateISO}
      />

      <main className="mx-auto grid max-w-[1500px] gap-6 px-4 pb-16 pt-6 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:px-8">
        <LeftPanel
          byShift={byShift}
          customers={customersToday}
          selectedId={selectedReservationId}
          onSelect={(r) => {
            setSelectedReservationId(r.id);
            setFloor(r.floor);
            setSelectedTable(r.table);
          }}
        />

        <RightPanel
          floor={floor}
          setFloor={setFloor}
          tables={tablesForFloor}
          tableMap={tableMap}
          selectedTable={selectedTable}
          setSelectedTable={setSelectedTable}
          onOpenNew={() => setModalOpen(true)}
          activeDate={activeDate}
        />
      </main>

      {modalOpen && (
        <NewReservationModal
          activeDateISO={activeDateISO}
          defaultFloor={floor}
          defaultTable={selectedTable ?? undefined}
          onClose={() => setModalOpen(false)}
          onSave={(r) => {
            addReservation(r);
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ─────────────── Header ─────────────── */

function Header({
  activeDate,
  onNew,
  totalToday,
  guestsToday,
}: {
  activeDate: Date;
  onNew: () => void;
  totalToday: number;
  guestsToday: number;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4 lg:grid-cols-[1fr_auto_1fr] lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-xl font-semibold leading-none">
              Thalassa
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Reservations · Athens
            </div>
          </div>
        </div>

        <div className="hidden items-center justify-center gap-3 lg:flex">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-card text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
          </div>
          <div className="text-center">
            <div className="font-display text-2xl font-semibold leading-none">
              {fmtDayNum(activeDate)} {fmtMonth(activeDate)}
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {dowLong(activeDate)}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <div className="hidden items-center gap-4 rounded-full border border-border bg-card px-4 py-2 text-sm md:flex">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <BookOpen className="h-3.5 w-3.5" />
              <span className="font-semibold text-foreground">{totalToday}</span>
              <span>bookings</span>
            </span>
            <span className="h-4 w-px bg-border" />
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              <span className="font-semibold text-foreground">
                {guestsToday}
              </span>
              <span>guests</span>
            </span>
          </div>

          <button
            onClick={onNew}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            New reservation
          </button>
        </div>
      </div>
    </header>
  );
}

/* ─────────────── Week nav ─────────────── */

function WeekNav({
  weekStart,
  weekDays,
  activeDateISO,
  onPrev,
  onNext,
  onPick,
}: {
  weekStart: Date;
  weekDays: { iso: string; d: Date; count: number; people: number }[];
  activeDateISO: string;
  onPrev: () => void;
  onNext: () => void;
  onPick: (iso: string) => void;
}) {
  const weekEnd = addDays(weekStart, 6);
  return (
    <section className="mx-auto max-w-[1500px] px-4 pt-6 lg:px-8">
      <div className="flex items-center justify-between pb-3">
        <div className="font-display text-lg font-medium text-muted-foreground">
          Week of{" "}
          <span className="text-foreground">
            {fmtMonth(weekStart)} {fmtDayNum(weekStart)}
          </span>
          <span className="mx-1.5 text-muted-foreground/60">—</span>
          <span className="text-foreground">
            {fmtMonth(weekEnd)} {fmtDayNum(weekEnd)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onPrev}
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground hover:shadow-sm"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={onNext}
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground hover:shadow-sm"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-2">
        {weekDays.map(({ iso, d, count, people }) => {
          const active = iso === activeDateISO;
          const isToday = iso === toISODate(new Date());
          return (
            <button
              key={iso}
              onClick={() => onPick(iso)}
              className={`group relative flex flex-col items-start gap-2 rounded-2xl border p-3 text-left transition sm:p-4 ${
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20"
                  : "border-border bg-card hover:border-foreground/20 hover:shadow-sm"
              }`}
            >
              <div className="flex w-full items-center justify-between">
                <div
                  className={`text-[10px] font-bold uppercase tracking-[0.2em] ${
                    active ? "text-primary-foreground/75" : "text-muted-foreground"
                  }`}
                >
                  {dowShort(d)}
                </div>
                {isToday && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      active
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-sage-soft text-sage"
                    }`}
                  >
                    Today
                  </span>
                )}
              </div>
              <div>
                <div
                  className={`font-display text-2xl font-semibold leading-none sm:text-3xl`}
                >
                  {fmtDayNum(d)}
                </div>
                <div
                  className={`mt-1 text-[11px] font-medium ${
                    active
                      ? "text-primary-foreground/75"
                      : "text-muted-foreground"
                  }`}
                >
                  {fmtMonth(d)}
                </div>
              </div>

              {count > 0 ? (
                <div className="mt-1 flex items-center gap-2 text-[11px] font-medium">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                      active
                        ? "bg-primary-foreground/15 text-primary-foreground"
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    <BookOpen className="h-3 w-3" />
                    {count}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                      active
                        ? "bg-primary-foreground/15 text-primary-foreground"
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    <Users className="h-3 w-3" />
                    {people}
                  </span>
                </div>
              ) : (
                <div
                  className={`mt-1 text-[11px] italic ${
                    active
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground/70"
                  }`}
                >
                  No reservations
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────────── Left panel: shifts + customers ─────────────── */

function LeftPanel({
  byShift,
  customers,
  selectedId,
  onSelect,
}: {
  byShift: Record<Shift, { bookings: number; guests: number }>;
  customers: Reservation[];
  selectedId: string | null;
  onSelect: (r: Reservation) => void;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-5">
      <div className="grid grid-cols-3 gap-3">
        {(["Breakfast", "Lunch", "Dinner"] as const).map((s) => {
          const stats = byShift[s];
          const active = stats.bookings > 0;
          return (
            <div
              key={s}
              className={`paper rounded-2xl p-4 transition ${
                active ? "" : "opacity-70"
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                {s}
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-display text-3xl font-semibold leading-none">
                  {stats.bookings}
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {stats.bookings === 1 ? "table" : "tables"}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span>{stats.guests} guests</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="paper flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <div>
            <div className="font-display text-lg font-semibold">
              Today's Guests
            </div>
            <div className="text-xs text-muted-foreground">
              {customers.length} reservation{customers.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Search guest"
              className="w-40 rounded-full border border-border bg-background/60 py-1.5 pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/60"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {customers.length === 0 ? (
            <div className="grid place-items-center gap-2 px-6 py-14 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-secondary text-muted-foreground">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="font-display text-base text-foreground">
                No reservations yet
              </div>
              <div className="text-xs text-muted-foreground">
                Add a new one from the top-right.
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {customers.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => onSelect(r)}
                    className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-4 text-left transition ${
                      selectedId === r.id
                        ? "bg-secondary/60"
                        : "hover:bg-secondary/40"
                    }`}
                  >
                    <TimeChip time={r.timeLabel} shift={r.shift} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-foreground">
                          {r.guestName}
                        </span>
                        <StatusPill status={r.status} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {r.guests} guests
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {FLOOR_LABEL[r.floor]} · T{r.table}
                        </span>
                        {r.note && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-terracotta-soft px-1.5 py-0.5 text-[10px] font-semibold text-terracotta">
                            {r.note}
                          </span>
                        )}
                      </div>
                    </div>
                    <SourceDot source={r.source} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function TimeChip({ time, shift }: { time: string; shift: Shift }) {
  const tone =
    shift === "Breakfast"
      ? "bg-amber-soft text-amber-ink"
      : shift === "Lunch"
        ? "bg-sage-soft text-sage"
        : "bg-terracotta-soft text-terracotta";
  return (
    <div
      className={`grid h-12 w-14 place-items-center rounded-xl text-center ${tone}`}
    >
      <div className="font-display text-sm font-semibold leading-none">
        {time}
      </div>
      <div className="mt-1 text-[9px] font-bold uppercase tracking-widest opacity-80">
        {shift.slice(0, 3)}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ReservationStatus }) {
  const map: Record<ReservationStatus, string> = {
    confirmed: "bg-sage-soft text-sage",
    "no-show": "bg-amber-soft text-amber-ink",
    cancelled: "bg-clay-soft text-clay",
  };
  const label =
    status === "no-show"
      ? "No-show"
      : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${map[status]}`}
    >
      {label}
    </span>
  );
}

function SourceDot({ source }: { source: ReservationSource }) {
  const iconMap = {
    phone: <Phone className="h-3 w-3" />,
    email: <Mail className="h-3 w-3" />,
    online: <BookOpen className="h-3 w-3" />,
    "walk-in": <Users className="h-3 w-3" />,
  } as const;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-2 py-1 text-[10px] font-semibold text-muted-foreground"
      title={source}
    >
      {iconMap[source]}
      <span className="capitalize">{source}</span>
    </span>
  );
}

/* ─────────────── Right panel: floor plan ─────────────── */

function RightPanel({
  floor,
  setFloor,
  tables,
  tableMap,
  selectedTable,
  setSelectedTable,
  onOpenNew,
  activeDate,
}: {
  floor: FloorType;
  setFloor: (f: FloorType) => void;
  tables: number[];
  tableMap: Map<number, Reservation>;
  selectedTable: number | null;
  setSelectedTable: (n: number | null) => void;
  onOpenNew: () => void;
  activeDate: Date;
}) {
  const occupied = tableMap.size;
  const free = tables.length - occupied;

  return (
    <div className="paper flex min-h-[560px] flex-col overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
        <div className="flex items-center gap-1 rounded-full border border-border bg-background/60 p-1">
          {(Object.keys(FLOOR_LABEL) as FloorType[]).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFloor(f);
                setSelectedTable(null);
              }}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                floor === f
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {FLOOR_LABEL[f]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs">
          <LegendDot className="bg-sage" label={`${free} free`} />
          <LegendDot className="bg-terracotta" label={`${occupied} taken`} />
          <span className="hidden text-muted-foreground sm:inline">
            <Clock className="mr-1 inline h-3 w-3" />
            {dowLong(activeDate)}
          </span>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto p-6">
        <FloorSVGBackground />
        <div className="relative z-10 grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-4">
          {tables.map((n) => {
            const res = tableMap.get(n);
            const isSelected = selectedTable === n;
            const taken = !!res;
            return (
              <button
                key={n}
                onClick={() => setSelectedTable(isSelected ? null : n)}
                className={`group relative flex aspect-square flex-col items-center justify-center rounded-2xl border text-center transition ${
                  taken
                    ? "border-terracotta/40 bg-terracotta text-primary-foreground shadow-md shadow-terracotta/20 hover:brightness-105"
                    : "border-border bg-card hover:-translate-y-0.5 hover:border-sage/60 hover:shadow-md"
                } ${isSelected ? "ring-2 ring-offset-2 ring-offset-background ring-foreground" : ""}`}
              >
                <div
                  className={`text-[10px] font-bold uppercase tracking-widest ${
                    taken ? "text-primary-foreground/75" : "text-muted-foreground"
                  }`}
                >
                  Table
                </div>
                <div className="font-display text-3xl font-semibold leading-none">
                  {n}
                </div>
                {taken ? (
                  <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold">
                    <Users className="h-3 w-3" />
                    {res.guests} · {res.timeLabel}
                  </div>
                ) : (
                  <div className="mt-1 text-[10px] font-medium text-sage">
                    Available
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedTable !== null && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-secondary/40 px-5 py-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Selected: </span>
            <span className="font-semibold">
              Table {selectedTable} — {FLOOR_LABEL[floor]}
            </span>
            {tableMap.get(selectedTable) && (
              <span className="ml-2 text-muted-foreground">
                · {tableMap.get(selectedTable)!.guestName}
              </span>
            )}
          </div>
          {!tableMap.get(selectedTable) && (
            <button
              onClick={onOpenNew}
              className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background transition hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" />
              Book this table
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function FloorSVGBackground() {
  return (
    <svg
      className="absolute inset-0 h-full w-full opacity-[0.06]"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id="grid"
          width="28"
          height="28"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 28 0 L 0 0 0 28"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
    </svg>
  );
}

/* ─────────────── New reservation modal ─────────────── */

function NewReservationModal({
  activeDateISO,
  defaultFloor,
  defaultTable,
  onClose,
  onSave,
}: {
  activeDateISO: string;
  defaultFloor: FloorType;
  defaultTable?: number;
  onClose: () => void;
  onSave: (r: Reservation) => void;
}) {
  const [dateISO, setDateISO] = useState(activeDateISO);
  const [shift, setShift] = useState<Shift>("Dinner");
  const [time, setTime] = useState("19:30");
  const [guests, setGuests] = useState(2);
  const [floor, setFloor] = useState<FloorType>(defaultFloor);
  const [table, setTable] = useState<number | undefined>(defaultTable);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<ReservationStatus>("confirmed");
  const [source, setSource] = useState<ReservationSource>("phone");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const save = () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError("Please enter guest name.");
      return;
    }
    if (!phone.trim() && !email.trim()) {
      setError("Add a phone or an email so we can reach the guest.");
      return;
    }
    if (!table) {
      setError("Assign a table.");
      return;
    }
    const [h] = time.split(":").map(Number);
    onSave({
      id: `r-${Date.now()}`,
      dateISO,
      shift: shiftForHour(h),
      timeLabel: time,
      guests,
      floor,
      table,
      status,
      source,
      guestName: `${firstName} ${lastName}`.trim(),
      phone: phone || email,
      note: note.trim() || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl overflow-hidden rounded-3xl bg-card shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-border/70 bg-linen px-6 py-5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-terracotta">
              Thalassa · Reservation
            </div>
            <div className="mt-1 font-display text-2xl font-semibold">
              New Reservation
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-6 py-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Guest */}
            <Section title="Guest" icon={<Users className="h-3.5 w-3.5" />}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name">
                  <input
                    className={inputCls}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Omar"
                  />
                </Field>
                <Field label="Last name">
                  <input
                    className={inputCls}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Kachrani"
                  />
                </Field>
              </div>
              <Field label="Phone">
                <input
                  className={inputCls}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+968 9901 1891"
                />
              </Field>
              <Field label="Email (optional)">
                <input
                  className={inputCls}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="guest@email.com"
                />
              </Field>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {["VIP", "Loyal", "Celebrity", "Anniversary", "Window seat"].map(
                  (tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setNote(tag)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                        note === tag
                          ? "border-terracotta bg-terracotta-soft text-terracotta"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tag}
                    </button>
                  ),
                )}
              </div>
            </Section>

            {/* Booking */}
            <Section
              title="Booking"
              icon={<CalendarDays className="h-3.5 w-3.5" />}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <input
                    type="date"
                    className={inputCls}
                    value={dateISO}
                    onChange={(e) => setDateISO(e.target.value)}
                  />
                </Field>
                <Field label="Time">
                  <input
                    type="time"
                    className={inputCls}
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Shift">
                <div className="grid grid-cols-3 gap-1.5 rounded-full border border-border bg-background/60 p-1">
                  {(["Breakfast", "Lunch", "Dinner"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setShift(s)}
                      className={`rounded-full py-1.5 text-xs font-semibold transition ${
                        shift === s
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Guests">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setGuests(Math.max(1, guests - 1))}
                    className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition hover:text-foreground"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <div className="grid flex-1 place-items-center rounded-lg border border-border bg-background/60 py-1.5 font-display text-xl font-semibold">
                    {guests}
                  </div>
                  <button
                    type="button"
                    onClick={() => setGuests(Math.min(30, guests + 1))}
                    className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground transition hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </Field>

              <Field label="Floor">
                <select
                  className={inputCls}
                  value={floor}
                  onChange={(e) => {
                    setFloor(e.target.value as FloorType);
                    setTable(undefined);
                  }}
                >
                  {(Object.keys(FLOOR_LABEL) as FloorType[]).map((f) => (
                    <option key={f} value={f}>
                      {FLOOR_LABEL[f]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Assign table">
                <div className="grid grid-cols-6 gap-1.5">
                  {FLOOR_TABLES[floor].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setTable(n)}
                      className={`rounded-lg border py-1.5 text-xs font-semibold transition ${
                        table === n
                          ? "border-terracotta bg-terracotta text-primary-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </Field>
            </Section>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Field label="Status">
              <select
                className={inputCls}
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as ReservationStatus)
                }
              >
                <option value="confirmed">Confirmed</option>
                <option value="no-show">No-show</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <Field label="Source">
              <select
                className={inputCls}
                value={source}
                onChange={(e) =>
                  setSource(e.target.value as ReservationSource)
                }
              >
                <option value="phone">Phone</option>
                <option value="email">Email</option>
                <option value="online">Online</option>
                <option value="walk-in">Walk-in</option>
              </select>
            </Field>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-clay/30 bg-clay-soft px-3 py-2 text-xs font-semibold text-clay">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-linen/60 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            Save reservation
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-input bg-background/60 px-3 py-2 text-sm outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/15 placeholder:text-muted-foreground";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-secondary text-foreground">
          {icon}
        </span>
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
