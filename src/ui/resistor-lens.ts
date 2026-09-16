import { ResistorMotion } from './resistor-motion';
/** Presentation only. Carrier paths do not participate in the circuit solver. */
export interface ResistorReading {
  voltageDrop: number;
  current: number;
  resistance: number;
  currentReference: number;
  paused: boolean;
}

export class ResistorLens {
  private readonly panel: HTMLDetailsElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private visible = false;
  private spatial = false;
  private dirty = true;
  private time = 0;
  private readonly motion = new ResistorMotion();
  private reading: ResistorReading = { voltageDrop: 0, current: 0, resistance: 1, currentReference: 0, paused: true };

  constructor(host: HTMLElement) {
    host.innerHTML = `<details class="resistor-lens">
      <summary>Inside the resistor <span>Follow the push, the drift, the heating</span></summary>
      <div class="resistor-lens-content">
        <div class="resistor-lens-title"><div><p>MICROSCOPIC LENS · SAME CIRCUIT</p><h3>Motion meets resistance.</h3></div><span class="lens-state"></span></div>
        <p class="lens-story"></p>
        <div class="lens-readings"><div>Voltage drop <output class="lens-voltage"></output><small>source side − capacitor side</small></div><div>Conventional current <output class="lens-current"></output><small>same current at both ends</small></div><div>Heating power <output class="lens-power"></output><small>energy transferred per second · I²R</small></div></div>
        <div class="lens-directions"><span class="lens-conventional"></span><span class="lens-electrons"></span></div>
        <canvas width="960" height="330" role="img" aria-label="Illustrative metallic resistor interior: negative electrons move irregularly among a vibrating lattice, with net drift opposite conventional current."></canvas>
        <div class="lens-power-row"><span>Heating now</span><div class="lens-power-track"><div></div></div><span class="lens-power-scale"></span></div>
        <p class="lens-caption">Blue − dots: electrons. Bronze spheres: the lattice. Random motion remains even when net current is zero. Warm light shows heating power, not temperature.</p>
        <details class="lens-limits"><summary>How to read this close-up</summary><p>A simplified metallic-conduction analogy. The electric field biases electron motion; scattering limits net drift, and electrical energy transfers to the material. The circuit solves I = ΔV/R and P = I²R, not these individual paths or collisions.</p><p>Particle number, spacing, agitation and drift speed are illustrative. Random increments are balanced to keep this small illustration from inventing current at zero. Dots wrap through the ends of this representative window; they are not tracked around the circuit. <span class="lens-window-note">In this fallback drawing, left is the source-side terminal and right the capacitor-side terminal.</span> Use Source / Return above to reverse a charged capacitor’s current.</p></details>
      </div></details>`;
    this.panel = host.querySelector('details')!;
    this.canvas = host.querySelector('canvas')!;
    this.context = this.canvas.getContext('2d');
    if (!this.context) this.canvas.replaceWith(document.createTextNode('Interior drawing unavailable; live circuit readings remain available.'));
    this.panel.addEventListener('toggle', () => { this.dirty = true; });
    new IntersectionObserver(([entry]) => { this.visible = entry.isIntersecting; this.dirty = true; }).observe(this.canvas);
    new ResizeObserver(() => { this.dirty = true; }).observe(this.canvas);
    this.reducedMotion.addEventListener('change', () => { this.dirty = true; });
  }

  setSpatialMode(spatial: boolean): void {
    this.spatial = spatial;
    this.canvas.hidden = spatial;
    (this.panel.querySelector('.lens-window-note') as HTMLElement).hidden = spatial;
    this.panel.querySelector('.resistor-lens-title p')!.textContent = spatial ? 'SELECTED RESISTOR · LIVE CIRCUIT READINGS' : 'MICROSCOPIC LENS · SAME CIRCUIT';
    this.panel.querySelector('.resistor-lens-title h3')!.textContent = spatial ? 'The resistor in your circuit.' : 'Motion meets resistance.';
    this.panel.querySelector('.lens-caption')!.textContent = spatial
      ? 'Follow the blue streaks along the leads and through this resistor: they show net electron flow, not individual electron trajectories. Microscopic random motion is not shown in the circuit view. Optional mint arrows show the opposite conventional-current direction. Warmth indicates heating power, not temperature.'
      : 'Blue − dots: electrons. Bronze spheres: the lattice. Random motion remains even when net current is zero. Warm light shows heating power, not temperature.';
    this.dirty = true;
  }

  update(reading: ResistorReading): void {
    this.reading = reading;
    this.dirty = true;
    const { current: i, voltageDrop: v, resistance: r, currentReference: full, paused } = reading;
    const power = i * i * r;
    const powerFull = full * full * r;
    const number = (n: number, unit: string) => `${Number(n.toPrecision(3))} ${unit}`;
    const text = (selector: string, value: string) => { this.panel.querySelector(selector)!.textContent = value; };
    text('.lens-voltage', number(v, 'V'));
    text('.lens-current', number(i, 'A'));
    text('.lens-power', number(power, 'W'));
    text('.lens-state', paused ? 'Paused' : this.reducedMotion.matches ? 'Running · still illustration' : 'Live circuit');
    text('.lens-conventional', i > 0 ? 'Current: source side → capacitor side' : i < 0 ? 'Current: capacitor side → source side' : 'Conventional current: zero');
    text('.lens-electrons', i > 0 ? 'Electron drift: capacitor side → source side' : i < 0 ? 'Electron drift: source side → capacitor side' : 'Electron net drift: zero');
    text('.lens-story', i === 0 ? 'No voltage difference across the resistor: no net drift or electrical heating. Microscopic motion remains.' : 'The voltage difference drives current. As the capacitor approaches the connected source voltage, that difference shrinks — so current and heating fade.');
    text('.lens-power-scale', `0–${number(powerFull, 'W')} · fixed display range`);
    (this.panel.querySelector('.lens-power-track > div') as HTMLElement).style.width = `${powerFull > 0 ? Math.min(1, power / powerFull) * 100 : 0}%`;
  }

  render(dt: number): void {
    if (this.spatial || !this.context || !this.panel.open || !this.visible || document.hidden) return;
    const animate = !this.reading.paused && !this.reducedMotion.matches && dt > 0;
    if (!this.dirty && !animate) return;
    const fraction = this.reading.currentReference > 0 ? this.reading.current / this.reading.currentReference : 0;
    if (animate) {
      this.time += dt;
      // Negative carriers drift opposite I. This is a display scale, not m/s.
      this.motion.advance(dt, fraction);
    }
    this.draw(fraction);
    this.dirty = false;
  }

  private draw(fraction: number): void {
    const ctx = this.context!;
    const width = Math.max(1, this.canvas.clientWidth);
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    const targetWidth = Math.round(width * ratio), targetHeight = Math.round(width * 330 / 960 * ratio);
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth; this.canvas.height = targetHeight;
    }
    ctx.setTransform(this.canvas.width / 960, 0, 0, this.canvas.height / 330, 0, 0);
    ctx.clearRect(0, 0, 960, 330);
    const heat = Math.min(1, fraction * fraction);
    const background = ctx.createLinearGradient(0, 0, 0, 330);
    background.addColorStop(0, '#111f2a'); background.addColorStop(1, '#080f18');
    ctx.fillStyle = background; ctx.fillRect(0, 0, 960, 330);
    const polygon = (points: number[][], fill: string, stroke = '#526573') => {
      ctx.beginPath(); points.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke();
    };
    // Cutaway slab: two end contacts and an exposed volume, not a blocking wall.
    polygon([[90,105],[165,62],[870,62],[795,105]], '#28323a');
    polygon([[90,105],[795,105],[795,255],[90,255]], '#192631');
    polygon([[795,105],[870,62],[870,212],[795,255]], '#233542');
    ctx.fillStyle = `rgba(245,135,60,${heat * .25})`; ctx.fillRect(90,105,705,150);
    for (const x of [65,800]) {
      polygon([[x,105],[x+55,73],[x+75,73],[x+20,105],[x+20,255],[x,255]], '#9a7153', '#d5ad7e');
      ctx.strokeStyle = '#8da6b5'; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(x===65?0:870,180); ctx.lineTo(x===65?65:960,180); ctx.stroke();
    }
    const sphere = (x: number, y: number, radius: number) => {
      const g = ctx.createRadialGradient(x-radius*.3,y-radius*.4,1,x,y,radius);
      g.addColorStop(0,'#dfbd86'); g.addColorStop(.4,'#907556'); g.addColorStop(1,'#353a40');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,radius,0,Math.PI*2); ctx.fill();
    };
    // Baseline lattice motion is independent of power; this is not a thermometer.
    for (let row=0; row<3; row++) for (let col=0; col<10; col++) {
      const n=row*10+col;
      sphere(141+col*67+row*9+Math.sin(this.time*(2.7+n*.113)+n*2)*1.8,120+row*48+Math.cos(this.time*(3.3+n*.079)+n)*1.8,11+row);
    }
    const wrap = (v: number) => ((v % 1) + 1) % 1;
    for (const particle of this.motion.particles) {
      const x=113+wrap(particle.x/674)*674;
      // Reflect at the drawing window's top/bottom; repeat through its ends.
      const y=110+(1-Math.abs(2*wrap(particle.y/250)-1))*125;
      ctx.fillStyle='#80ceef'; ctx.beginPath(); ctx.arc(x,y,4.5,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#112a3b'; ctx.lineWidth=1.3; ctx.beginPath();ctx.moveTo(x-2,y);ctx.lineTo(x+2,y);ctx.stroke();
    }
    ctx.font='16px system-ui'; ctx.fillStyle='#b5c9d2'; ctx.textAlign='left'; ctx.fillText('SOURCE SIDE',35,301);
    ctx.textAlign='right';ctx.fillText('CAPACITOR SIDE',925,301);
    ctx.textAlign='center';ctx.fillStyle='#d4b18b';ctx.fillText('Exposed metallic interior · illustrative motion',480,35);
  }
}
