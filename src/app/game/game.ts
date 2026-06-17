import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { HudState, SceneEngine } from './scene-engine';

@Component({
  selector: 'app-game',
  template: `<div #host class="game-host"></div>`,
  styles: [
    `
      .game-host {
        position: fixed;
        inset: 0;
      }
      .game-host canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class Game implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) private hostRef!: ElementRef<HTMLElement>;
  private engine?: SceneEngine;

  private readonly el: Record<string, HTMLElement | null> = {};
  private last = { coins: -1, gems: -1, level: -1, hpPct: -1, coords: '' };

  constructor(private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.engine = new SceneEngine(this.hostRef.nativeElement, this.renderHud);
      this.engine.start();
    });
  }

  ngOnDestroy(): void {
    this.engine?.dispose();
  }

  private grab(id: string): HTMLElement | null {
    if (!(id in this.el)) this.el[id] = document.getElementById(id);
    return this.el[id];
  }

  /** Reflects the live game state into the HUD (runs each frame, off-zone). */
  private readonly renderHud = (s: HudState): void => {
    // roll cooldown widget
    const cd = this.grab('rollcd');
    if (cd) {
      const cooling = s.rollCd > 0.05;
      cd.classList.toggle('cooling', cooling);
      const fill = this.grab('rollcd-fill');
      if (fill) fill.style.transform = `scaleY(${cooling ? s.rollCd / s.rollCdMax : 0})`;
      const time = this.grab('rollcd-time');
      if (time) time.textContent = cooling ? s.rollCd.toFixed(1) : '';
    }

    // health bar
    const hpPct = Math.max(0, Math.min(100, (s.hp / s.maxHp) * 100));
    if (Math.abs(hpPct - this.last.hpPct) > 0.4) {
      this.last.hpPct = hpPct;
      const fill = this.grab('hp-fill');
      if (fill) fill.style.width = hpPct + '%';
      const text = this.grab('hp-text');
      if (text) text.textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;
    }

    // level, coins, gems (only touch the DOM when they change)
    if (s.level !== this.last.level) {
      this.last.level = s.level;
      const e = this.grab('level');
      if (e) e.textContent = `Niv. ${s.level}`;
    }
    if (s.coins !== this.last.coins) {
      this.last.coins = s.coins;
      const e = this.grab('coins');
      if (e) e.textContent = s.coins.toLocaleString('fr-FR');
    }
    if (s.gems !== this.last.gems) {
      this.last.gems = s.gems;
      const e = this.grab('gems');
      if (e) e.textContent = String(s.gems);
    }

    // minimap player marker (position + facing) and coordinates
    // minimap is centred on the player: the world scrolls, the marker stays put
    const world = this.grab('mm-world');
    if (world) {
      world.setAttribute('transform', `translate(${(-s.px * 4.89).toFixed(2)} ${(-s.pz * 4.89).toFixed(2)})`);
    }

    const mk = this.grab('mm-player');
    if (mk) {
      const angle = 180 - (s.heading * 180) / Math.PI;
      mk.setAttribute('transform', `rotate(${angle.toFixed(1)} 50 48)`); // centred, only turns
    }

    const bob = this.grab('mm-bobber');
    if (bob) {
      if (s.casting) {
        bob.style.display = '';
        bob.setAttribute(
          'transform',
          `translate(${((s.bx - s.px) * 4.89).toFixed(2)} ${((s.bz - s.pz) * 4.89).toFixed(2)})`,
        );
      } else {
        bob.style.display = 'none';
      }
    }

    const coords = `x ${s.px.toFixed(0)} · z ${s.pz.toFixed(0)}`;
    if (coords !== this.last.coords) {
      this.last.coords = coords;
      const e = this.grab('mm-coords');
      if (e) e.textContent = coords;
    }
  };
}
