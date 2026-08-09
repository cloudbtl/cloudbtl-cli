import pc from 'picocolors';

export function fmtMs(ms: number): string {
  if (!ms) return '0s';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function accessLabel(mode: string): string {
  if (mode === 'org') return pc.cyan('org');
  if (mode === 'passcode') return pc.yellow('passcode');
  return pc.dim('public');
}

/** Render an aligned text table. Header cells are dimmed; ANSI width is ignored when padding. */
export function table(headers: string[], rows: string[][]): string {
  const all = [headers, ...rows];
  const widths = headers.map((_, c) => Math.max(...all.map((r) => visibleLen(r[c] ?? ''))));
  const line = (cells: string[]) =>
    cells.map((cell, c) => pad(cell ?? '', widths[c] ?? 0)).join('  ');
  const out = [line(headers.map((h) => pc.dim(h)))];
  for (const r of rows) out.push(line(r));
  return out.join('\n');
}

function visibleLen(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - visibleLen(s)));
}

// ── JSON 출력 모드 (에이전트/스크립트) ──
let JSON_MODE = false;
export function setJsonMode(v: boolean): void {
  JSON_MODE = v;
}
export function isJson(): boolean {
  return JSON_MODE;
}
/** JSON 모드면 data 를 출력, 아니면 human() 실행. 각 명령의 출력부를 이걸로 감싼다. */
export function emit(data: unknown, human: () => void): void {
  if (JSON_MODE) console.log(JSON.stringify(data, null, 2));
  else human();
}

export const ok = (s: string) => pc.green(s);
export const warn = (s: string) => pc.yellow(s);
export const err = (s: string) => pc.red(s);
export const dim = (s: string) => pc.dim(s);
export const bold = (s: string) => pc.bold(s);
