import { Component } from '@angular/core';
import { fromPairs } from 'lodash';
import { faHome } from '../../../client/icons';
import { ponyStates, } from '../../../client/ponyStates';
import { AgDragEvent } from '../../shared/directives/agDrag';
import { AnimatorState } from '../../../common/animator';
import { distance, flatten } from '../../../common/utils';

function getPos(key: string, type: 'x' | 'y', defaultValue = 100) {
	const item = localStorage.getItem(`tools-stats-${key}-${type}`);
	return item ? parseInt(item, 10) : defaultValue;
}

function setPos(key: string, type: 'x' | 'y', value: number) {
	localStorage.setItem(`tools-stats-${key}-${type}`, value.toString());
}

const defaultPositions: any = {
	'any': { 'x': 917, 'y': 43 },
	'standing': { 'x': 317, 'y': 300 },
	'trotting': { 'x': 660, 'y': 304 },
	'swimming': { 'x': 988, 'y': 435 },
	'swimming-to-trotting': { 'x': 747, 'y': 548 },
	'trotting-to-swimming': { 'x': 805, 'y': 413 },
	'booping': { 'x': 106, 'y': 301 },
	'booping-sitting': { 'x': 111, 'y': 569 },
	'booping-lying': { 'x': 127, 'y': 821 },
	'booping-flying': { 'x': 110, 'y': 64 },
	'sitting': { 'x': 312, 'y': 569 },
	'sitting-down': { 'x': 186, 'y': 437 },
	'standing-up': { 'x': 313, 'y': 436 },
	'sitting-to-trotting': { 'x': 517, 'y': 500 },
	'lying': { 'x': 326, 'y': 818 },
	'lying-down': { 'x': 254, 'y': 692 },
	'sitting-up': { 'x': 385, 'y': 682 },
	'lying-to-trotting': { 'x': 541, 'y': 731 },
	'hovering': { 'x': 334, 'y': 21 },
	'flying': { 'x': 641, 'y': 29 },
	'flying-up': { 'x': 378, 'y': 182 },
	'flying-down': { 'x': 247, 'y': 177 },
	'trotting-to-flying': { 'x': 601, 'y': 188 },
	'flying-to-trotting': { 'x': 805, 'y': 270 },
	'swinging': { 'x': 484, 'y': 238 },
	'swimming-to-flying': { 'x': 1063, 'y': 182 },
	'flying-to-swimming': { 'x': 938, 'y': 232 },
	'booping-swimming': { 'x': 1144, 'y': 432 }
};

@Component({
	selector: 'tools-states',
	templateUrl: 'tools-states.pug',
	styleUrls: ['tools-states.scss'],
})
export class ToolsStates {
	readonly homeIcon = faHome;
	private startX = 0;
	private startY = 0;
	arrowColors = ['orange', 'red', 'lime'];
	states = ponyStates.map(state => {
		const def = defaultPositions[state.name] || { x: 0, y: 0 };

		return {
			color: state.name === 'any' ? 'orange' : (state.animation.loop ? 'LightSeaGreen' : 'cornflowerblue'),
			name: state.name,
			variants: Object.keys(state.variants || {}).join(', '),
			state,
			x: getPos(state.name, 'x', def.x),
			y: getPos(state.name, 'y', def.y),
		};
	});
	arrows: { path: string; color: string; }[] = [];
	times: { x: number; y: number; color: string; text: string; title?: string; }[] = [];
	constructor() {
		this.updateArrows();
	}
	drag(state: any, { dx, dy, type }: AgDragEvent) {
		if (type === 'start') {
			this.startX = state.x;
			this.startY = state.y;
		}

		setPos(state.name, 'x', state.x = this.startX + dx);
		setPos(state.name, 'y', state.y = this.startY + dy);
		this.updateArrows();
	}
	logPositions() {
		const positions = fromPairs(this.states.map(({ name, x, y }) => [name, { x, y }]));
		console.log(JSON.stringify(positions).replace(/"/g, `'`).replace(/},/g, '},\n'));
	}
	private updateArrows() {
		this.times = [];
		this.arrows = flatten(this.states.map(s => s.state.from.map(f => ({
			to: s,
			from: this.findState(f.state),
			color: f.exitAfter === 0 ? (f.keepTime ? 'orange' : 'red') : 'lime',
			exitAfter: f.exitAfter,
			enterTime: f.enterTime,
			onlyDirectTo: f.onlyDirectTo,
		}))))
			.filter(({ from, to }) => from && to)
			.map(({ from, to, color, exitAfter, enterTime, onlyDirectTo }) => {
				const length = distance(from, to) || 1;
				const r1 = 50;
				const nx1 = ((to.x - from.x) / length) * r1;
				const ny1 = ((to.y - from.y) / length) * r1;
				const r2 = 60;
				const nx2 = ((to.x - from.x) / length) * r2;
				const ny2 = ((to.y - from.y) / length) * r2;
				const r3 = 75;
				const nx3 = ((to.x - from.x) / length) * r3;
				const ny3 = ((to.y - from.y) / length) * r3;
				const r4 = 80;
				const nx4 = ((to.x - from.x) / length) * r4;
				const ny4 = ((to.y - from.y) / length) * r4;

				const fromX = from.x + nx1;
				const fromY = from.y + ny1;

				if (exitAfter) {
					this.times.push({ x: fromX, y: fromY, color, text: exitAfter.toFixed(1) });
				}

				if (enterTime) {
					this.times.push({ x: to.x - nx3, y: to.y - ny3, color, text: enterTime.toFixed(1) });
				}

				if (onlyDirectTo) {
					this.times.push({
						x: from.x + nx4, y: from.y + ny4, color, text: '?', title: `only directly to: ${onlyDirectTo.name}`
					});
				}

				return { path: `M ${fromX} ${fromY} L ${to.x - nx2} ${to.y - ny2}`, color };
			});
	}
	private findState(state: AnimatorState<any>) {
		return this.states.find(s => s.state === state)!;
	}
}
