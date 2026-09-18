// Guided tour: a sequence of standing viewpoints. Travel is always a blink (fade to
// black, move, fade in) so the visitor never experiences continuous artificial motion.
import type { TourStop } from '../config';

export interface TourPresenter {
    /** Move the visitor to the stop and face its look target. Resolves when arrived. */
    travel(stop: TourStop): Promise<void>;
    /** Show or update the caption for the current stop. */
    caption(stop: TourStop, index: number, total: number): void;
    /** The tour ended or was stopped. */
    end(): void;
}

export class Tour {
    active = false;

    index = -1;

    private stops: TourStop[];

    private presenter: TourPresenter;

    private timer = 0;

    private travelling = false;

    private onChange: (() => void) | null;

    constructor(stops: TourStop[], presenter: TourPresenter, onChange: (() => void) | null = null) {
        this.stops = stops;
        this.presenter = presenter;
        this.onChange = onChange;
    }

    setPresenter(p: TourPresenter) {
        this.presenter = p;
    }

    start() {
        if (this.active) return;
        this.active = true;
        this.index = -1;
        this.onChange?.();
        this.next();
    }

    stop() {
        if (!this.active) return;
        this.active = false;
        this.index = -1;
        this.presenter.end();
        this.onChange?.();
    }

    toggle() {
        if (this.active) this.stop();
        else this.start();
    }

    async next() {
        if (!this.active || this.travelling) return;
        if (this.index + 1 >= this.stops.length) {
            this.stop();
            return;
        }
        await this.goTo(this.index + 1);
    }

    async prev() {
        if (!this.active || this.travelling || this.index <= 0) return;
        await this.goTo(this.index - 1);
    }

    private async goTo(i: number) {
        this.travelling = true;
        this.index = i;
        const stop = this.stops[i];
        this.timer = stop.dwell;
        try {
            await this.presenter.travel(stop);
        } finally {
            this.travelling = false;
        }
        if (this.active && this.index === i) {
            this.presenter.caption(stop, i, this.stops.length);
            this.onChange?.();
        }
    }

    update(dt: number) {
        if (!this.active || this.travelling || this.index < 0) return;
        this.timer -= dt;
        if (this.timer <= 0) this.next();
    }

    get remaining() {
        return Math.max(0, this.timer);
    }
}
