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
  private last = {
    coins: -1,
    gems: -1,
    level: -1,
    hpPct: -1,
    coords: '',
    selectedHotbar: -1,
    invVersion: -1,
    invOpen: false,
  };
  private heldEl?: HTMLElement; // floating stack that follows the cursor while dragging

  constructor(private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.engine = new SceneEngine(this.hostRef.nativeElement, this.renderHud);
      this.engine.start();
      this.setupHud();
    });
  }

  /** Wire pointer drag-and-drop + hotbar selection for the Minecraft hotbar / inventory. */
  private setupHud(): void {
    const eng = this.engine;
    if (!eng) return;
    document.addEventListener('mousedown', (ev) => {
      const slot = (ev.target as HTMLElement | null)?.closest('[data-idx]') as HTMLElement | null;
      if (!slot) return;
      const idx = Number(slot.dataset['idx']);
      if (!slot.closest('#inventory')) {
        eng.selectHotbar(idx); // a tap on the closed hotbar just selects that slot
        return;
      }
      ev.preventDefault(); // an inventory slot starts a drag: pick up (or place if holding)
      if (eng.getHeld()) eng.placeAt(idx);
      else eng.pickUp(idx);
      this.updateHeld(ev);
    });
    document.addEventListener('mousemove', (ev) => this.moveHeld(ev));
    document.addEventListener('mouseup', (ev) => {
      if (!eng.getHeld()) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const slot = el?.closest('[data-idx]') as HTMLElement | null;
      if (slot && slot.closest('#inventory')) eng.placeAt(Number(slot.dataset['idx']));
      else eng.returnHeld(); // dropped outside any slot → snap back
      this.updateHeld(ev);
    });
  }

  /** Show / refresh / hide the floating stack that follows the cursor while dragging. */
  private updateHeld(ev: MouseEvent): void {
    const held = this.engine?.getHeld() ?? null;
    if (held) {
      if (!this.heldEl) {
        this.heldEl = document.createElement('div');
        this.heldEl.className = 'mc-held';
        document.body.appendChild(this.heldEl);
      }
      this.heldEl.innerHTML = `${this.iconHtml(held.icon)}${held.count > 1 ? `<i class="ct">${held.count}</i>` : ''}`;
      this.moveHeld(ev);
    } else if (this.heldEl) {
      this.heldEl.remove();
      this.heldEl = undefined;
    }
  }

  private moveHeld(ev: MouseEvent): void {
    if (this.heldEl) {
      this.heldEl.style.left = ev.clientX + 'px';
      this.heldEl.style.top = ev.clientY + 'px';
    }
  }

  /** A slot/cursor icon: a pixel-art <img> when it's a sprite path, else the emoji text. */
  private iconHtml(icon: string): string {
    return icon.includes('/')
      ? `<img class="ic" src="${icon}" alt="" draggable="false">`
      : `<span class="ic">${icon}</span>`;
  }

  /** Rebuild the hotbar (and, when open, the inventory grids) from the engine's slots. */
  private renderSlots(selected: number, invOpen: boolean): void {
    const eng = this.engine;
    if (!eng) return;
    const slots = eng.getSlots();
    const row = (from: number, to: number): string => {
      let h = '';
      for (let i = from; i < to; i++) {
        const st = slots[i];
        const sel = i === selected ? ' sel' : '';
        const inner = st
          ? `${this.iconHtml(st.icon)}${st.count > 1 ? `<i class="ct">${st.count}</i>` : ''}`
          : '';
        h += `<div class="mc-slot${sel}" data-idx="${i}">${inner}</div>`;
      }
      return h;
    };
    const bar = this.grab('hotbar-bar');
    if (bar) bar.innerHTML = row(0, 9);
    if (invOpen) {
      const main = this.grab('inv-main');
      if (main) main.innerHTML = row(9, 45); // main bag: 4×9 (slots 9-44)
      const hot = this.grab('inv-hotbar');
      if (hot) hot.innerHTML = row(0, 9); // hotbar row, separated at the bottom
    }
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

    // inventory panel open / close
    if (s.invOpen !== this.last.invOpen) {
      this.last.invOpen = s.invOpen;
      const inv = this.grab('inventory');
      if (inv) inv.style.display = s.invOpen ? '' : 'none';
      if (!s.invOpen && this.heldEl) {
        this.heldEl.remove();
        this.heldEl = undefined;
      }
      this.renderSlots(s.selectedHotbar, s.invOpen);
    }
    // re-render the slots whenever the inventory contents or the selection change
    if (s.invVersion !== this.last.invVersion || s.selectedHotbar !== this.last.selectedHotbar) {
      this.last.invVersion = s.invVersion;
      this.last.selectedHotbar = s.selectedHotbar;
      this.renderSlots(s.selectedHotbar, s.invOpen);
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
