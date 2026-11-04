export type PlayerState = 'idle' | 'playing' | 'paused' | 'ended';

export interface FilmScene { id: string; label: string; caption: string; start: number; end: number }
export interface FilmChapter { id: string; label: string; at: number }
export interface Film { id: string; title: string; width: number; height: number; posterAt: number; build(): unknown }

export interface MoviePlayerOptions {
  film?: Film;
  /** Show the built-in control bar (default true). Pass false to drive it from your own UI. */
  controls?: boolean;
  /** Start with the caption bar on (default false). */
  captions?: boolean;
  /** 'auto' follows prefers-reduced-motion (default); true / false forces it. */
  reducedMotion?: 'auto' | boolean;
  autoplay?: boolean;
  /** Space/K, arrows, Home/End, R, C, F while the player has focus (default true). */
  keyboard?: boolean;
}

export interface MoviePlayer {
  load(film: Film): MoviePlayer;
  play(): MoviePlayer;
  pause(): MoviePlayer;
  toggle(): MoviePlayer;
  /** Jump to a time in ms. Stays paused if paused, keeps playing if playing. */
  seek(ms: number): MoviePlayer;
  /** Back to 0 and play. */
  restart(): MoviePlayer;
  /** Jump to the final frame. */
  skip(): MoviePlayer;
  setCaptions(on: boolean): void;
  setReducedMotion(on: boolean): void;
  on(type: 'state', fn: (s: PlayerState) => void): () => void;
  on(type: 'time', fn: (ms: number) => void): () => void;
  on(type: 'scene', fn: (scene: FilmScene) => void): () => void;
  on(type: 'load', fn: (film: Film) => void): () => void;
  off(type: string, fn: (...args: any[]) => void): void;
  readonly state: PlayerState;
  readonly time: number;
  readonly duration: number;
  readonly scenes: FilmScene[];
  readonly chapters: FilmChapter[];
  readonly reducedMotion: boolean;
  readonly captions: boolean;
  readonly element: HTMLElement;
  readonly stage: HTMLElement;
  destroy(): void;
}

export function createMoviePlayer(container: HTMLElement, options?: MoviePlayerOptions): MoviePlayer;
export function createTimeline(root: Element, opts: { duration: number; cues: unknown[]; reducedMotion?: boolean }): unknown;
export function defineFilm(def: unknown): Film;
export const thatMinesMine: Film;

export interface FilmEntry { id: string; title: string; hidden?: boolean; load(): Promise<{ default: Film }> }
export const FILMS: FilmEntry[];
export function listFilms(opts?: { includeHidden?: boolean }): FilmEntry[];
/** Lazily import a registered film by id. Rejects for an unknown id. */
export function loadFilm(id: string): Promise<Film>;
