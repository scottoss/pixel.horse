import { Component, ViewChild, ElementRef } from '@angular/core';
import { AdminModel } from '../../../services/adminModel';
import { TimingEntry, TimingEntryType, WorldPerfStats, defaultWorldPerfStats } from '../../../../common/adminInterfaces';
import { findById, pointInRect, clamp } from '../../../../common/utils';
import { SERVER_FPS } from '../../../../common/constants';
import { AgDragEvent } from '../../../shared/directives/agDrag';

interface Tooltip {
	x: number;
	y: number;
	w: number;
	h: number;
	text: string;
}

interface ListingEntry {
	name: string;
	count: number;
	selfTime: number;
	totalTime: number;
	selfPercent: number;
	totalPercent: number;
}

const frameTime = 1000 / SERVER_FPS;
const timePadding = 10; // ms

@Component({
	selector: 'admin-reports-perf',
	templateUrl: 'admin-reports-perf.pug',
})
export class AdminReportsPerf {
	@ViewChild('container', { static: true }) container!: ElementRef;
	@ViewChild('canvas', { static: true }) canvas!: ElementRef;
	@ViewChild('tooltip', { static: true }) tooltip!: ElementRef;
	loaded = false;
	server = '';
	startTime = 0;
	endTime = 0;
	listing: ListingEntry[] = [];
	timings: TimingEntry[] = [];
	worldPerfStats = defaultWorldPerfStats();
	private tooltips: Tooltip[] = [];
	private startTimeFrom = 0;
	private endTimeFrom = 0;
	private frame: any = 0;
	private lastZoom = 0;
	constructor(private model: AdminModel) {
		if (DEVELOPMENT) {
			const interval = setInterval(() => {
				if (findById(this.model.state.gameServers, 'dev')) {
					clearInterval(interval);
					this.load('dev');
				}
			}, 100);
		}

		setInterval(this.update, frameTime, this);
	}
	get servers() {
		return this.model.state.gameServers.map(s => s.id);
	}
	disable() {
		this.loaded = false;
		this.timings = [];
		this.listing = [];
		this.model.setTimingEnabled(this.server, false);
		this.redraw();
	}
	async enable() {
		this.loaded = true;
		await this.load(this.server);
	}
	async load(server: string) {
		this.server = server;
		this.timings = [];
		this.loaded = false;
		const result = await this.model.getTimings(server);

		if (result) {
			this.loaded = true;
			this.timings = result as TimingEntry[];
			this.setupZoom();
			this.recalcListing();
		}

		this.redraw();
	}
	async update(self: AdminReportsPerf) {
		if (self.server) {
			const result = await self.model.getWorldPerfStats(self.server);
			if (result) {
				self.worldPerfStats = result as WorldPerfStats;
			}
		}
		else {
			self.worldPerfStats = defaultWorldPerfStats();
		}
	}
	mouseMove(e: MouseEvent) {
		const rect = this.container.nativeElement.getBoundingClientRect() as DOMRect;
		const x = e.pageX - rect.left;
		const y = e.pageY - rect.top;

		const tooltip = this.tooltips.find(t => pointInRect(x, y, t));
		const element = this.tooltip.nativeElement as HTMLElement;

		if (tooltip) {
			element.style.display = 'block';
			element.style.left = `${x + 10}px`;
			element.style.top = `${y + 10}px`;
			element.innerText = tooltip.text;
		} else {
			element.style.display = 'none';
		}
	}
	wheel(e: WheelEvent) {
		e.preventDefault();

		const deltaY = clamp(e.deltaY, -1, 1);
		const change = ((this.endTime - this.startTime) * 0.2 * deltaY);
		const rect = this.container.nativeElement.getBoundingClientRect() as DOMRect;
		const ratioFromLeft = (e.pageX - rect.left) / rect.width;

		this.startTime = this.startTime - change * ratioFromLeft;
		this.endTime = this.endTime + change * (1 - ratioFromLeft);

		this.redraw();
	}
	setupZoom() {
		switch (this.lastZoom) {
			case 0:
			default:
				this.resetZoom();
				break;
			case 1:
				this.fitZoom();
				break;
			case 2:
				this.fullFrameZoom();
				break;
		}
	}
	resetZoom() {
		if (!this.timings.length) {
			return;
		}

		const firstTime = this.timings[0].time;
		const lastTime = this.timings[this.timings.length - 1].time;
		this.startTime = firstTime - timePadding;
		this.endTime = lastTime + timePadding;
		this.redraw();
		this.lastZoom = 0;
	}
	fitZoom() {
		if (!this.timings.length) {
			return;
		}

		const firstTime = this.timings[0].time;
		const lastTime = this.timings[this.timings.length - 1].time;
		const totalTime = lastTime - firstTime;
		this.startTime = firstTime - totalTime * 0.05;
		this.endTime = lastTime + totalTime * 0.05;
		this.redraw();
		this.lastZoom = 1;
	}
	fullFrameZoom() {
		if (!this.timings.length) {
			return;
		}

		const firstTime = this.timings[0].time;
		const lastTime = firstTime + frameTime;
		this.startTime = firstTime - 2;
		this.endTime = lastTime + 2;
		this.redraw();
		this.lastZoom = 2;
	}
	drag(e: AgDragEvent) {
		if (e.type === 'start') {
			this.startTimeFrom = this.startTime;
			this.endTimeFrom = this.endTime;
		}

		const scale = (this.endTime - this.startTime) / this.canvas.nativeElement.width;
		this.startTime = this.startTimeFrom - e.dx * scale;
		this.endTime = this.endTimeFrom - e.dx * scale;
		this.redraw();
	}
	redraw() {
		this.frame = this.frame || requestAnimationFrame(() => this.draw());
	}
	draw() {
		this.frame = 0;

		const rect = this.container.nativeElement.getBoundingClientRect() as DOMRect;
		const canvas = this.canvas.nativeElement as HTMLCanvasElement;
		canvas.width = rect.width;
		canvas.height = 400;

		const context = canvas.getContext('2d')!;
		context.fillStyle = '#222';
		context.fillRect(0, 0, canvas.width, canvas.height);

		this.tooltips.length = 0;

		if (!this.timings.length)
			return;

		const firstTime = this.timings[0].time;
		const startTime = this.startTime;
		const endTime = this.endTime;
		const totalTime = endTime - startTime;
		const timeScale = canvas.width / totalTime;

		function timeToX(time: number) {
			return (time - startTime) * timeScale;
		}

		function timeToXAligned(time: number) {
			return Math.floor(timeToX(time)) + 0.5;
		}

		context.textBaseline = 'middle';
		context.font = 'Arial 14px normal';

		// scale
		const scaleHeight = 20;

		context.strokeStyle = '#666';
		context.beginPath();

		for (let time = firstTime; time < endTime; time += frameTime) {
			context.moveTo(timeToXAligned(time), 0);
			context.lineTo(timeToXAligned(time), canvas.height);
		}

		context.stroke();

		context.strokeStyle = '#ddd';
		context.beginPath();
		context.moveTo(0, scaleHeight + 0.5);
		context.lineTo(canvas.width, scaleHeight + 0.5);
		context.stroke();

		// entries
		const rowHeight = 20;
		const startStack: TimingEntry[] = [];

		for (const entry of this.timings) {
			if (entry.type === TimingEntryType.Start) {
				startStack.push(entry);
			} else {
				const start = startStack.pop()!;
				const name = start.name!;
				const startX = timeToX(start.time);
				const endX = timeToX(entry.time);
				const y = scaleHeight + 2 + startStack.length * rowHeight;
				const w = endX - startX;
				let text = name;
				const time = entry.time - start.time;

				if (startStack.length === 0) {
					context.fillStyle = '#efc457';
					text = `${text} (${time.toFixed(2)} ms) ${(100 * time / frameTime).toFixed(0)}%`;
				} else if (/\(\)$/.test(name)) {
					context.fillStyle = '#d4ecc6';
				} else {
					context.fillStyle = '#c6dcec';
				}

				context.fillRect(startX, y, w, rowHeight - 1);
				this.tooltips.push({ x: startX, y, w, h: rowHeight, text: `${name}\n${time.toFixed(2)} ms` });

				if (w > 4) {
					context.fillStyle = '#222';
					context.fillText(text, startX + 4, y + rowHeight / 2);
				}
			}
		}
	}
	recalcListing() {
		if (!this.timings.length) {
			return;
		}

		interface Entry extends TimingEntry {
			excludedTime: number;
		}

		this.listing = [];
		const startStack: Entry[] = [];

		for (const entry of this.timings) {
			if (entry.type === TimingEntryType.Start) {
				startStack.push({ ...entry, excludedTime: 0 });
			} else {
				const start = startStack.pop()!;
				const name = start.name!;
				const time = entry.time - start.time;

				let listing = this.listing.find(l => l.name === name);

				if (!listing) {
					listing = { name, selfTime: 0, totalTime: 0, selfPercent: 0, totalPercent: 0, count: 0 };
					this.listing.push(listing);
				}

				listing.count++;
				listing.selfTime += (time - start.excludedTime);
				listing.totalTime += time;

				if (startStack.length) {
					startStack[startStack.length - 1].excludedTime += time;
				}
			}
		}

		const firstTime = this.timings[0].time;
		const lastTime = this.timings[this.timings.length - 1].time;
		const totalTime = lastTime - firstTime;

		for (const listing of this.listing) {
			listing.selfPercent = 100 * listing.selfTime / totalTime;
			listing.totalPercent = 100 * listing.totalTime / totalTime;
		}

		this.listing.sort((a, b) => b.selfTime - a.selfTime);
	}
}
