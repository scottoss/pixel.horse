import { Component } from '@angular/core';
import { discordLink } from '../../../client/data';
import { GENERAL_RULES } from '../../../common/constants';

@Component({
	selector: 'play-notice',
	templateUrl: 'play-notice.pug',
})
export class PlayNotice {
	readonly discordLink = discordLink;
	readonly rules = GENERAL_RULES;
}
