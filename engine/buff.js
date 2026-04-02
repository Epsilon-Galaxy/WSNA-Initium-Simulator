export class Buff {
    constructor(name = 'Custom Buff', stat = 'str', flatValue = 0.0, pctValue = 0.0) {
        this.name = name;
        this.stat = stat;
        this.flatValue = flatValue;
        this.pctValue = pctValue;
    }

    toDict() {
        return {
            name: this.name,
            stat: this.stat,
            flatValue: this.flatValue,
            pctValue: this.pctValue
        };
    }

    static fromDict(d) {
        if (d.flatValue !== undefined || d.pctValue !== undefined) {
            return new Buff(
                d.name,
                d.stat,
                d.flatValue ?? 0.0,
                d.pctValue ?? 0.0
            );
        }
        const val = d.value ?? 0.0;
        if (d.is_percent) {
            return new Buff(d.name, d.stat, 0.0, val);
        }
        return new Buff(d.name, d.stat, val, 0.0);
    }

    describe() {
        const parts = [];
        if (this.flatValue !== 0) {
            parts.push(`${this.flatValue > 0 ? '+' : ''}${this.flatValue.toFixed(1)} flat`);
        }
        if (this.pctValue !== 0) {
            parts.push(`${this.pctValue > 0 ? '+' : ''}${this.pctValue.toFixed(1)}%`);
        }
        return `${this.name} [${this.stat}: ${parts.length > 0 ? parts.join(', ') : 'no effect'}]`;
    }
}
