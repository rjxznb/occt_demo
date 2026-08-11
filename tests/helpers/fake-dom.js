export class FakeElement {
    constructor(tagName) {
        this.tagName = String(tagName).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.dataset = {};
        this.style = {};
        this.hidden = false;
        this.textContent = '';
        this.title = '';
        this.type = '';
        this.listeners = new Map();
        this.rect = { left: 0, top: 0, width: 200, height: 100 };
        const classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            toggle: (name, force) => {
                const enabled = force === undefined ? !classes.has(name) : Boolean(force);
                if (enabled) classes.add(name);
                else classes.delete(name);
                return enabled;
            },
            contains: name => classes.has(name),
            toString: () => [...classes].join(' '),
        };
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    replaceChildren(...children) {
        this.children.forEach(child => { child.parentNode = null; });
        this.children = [];
        children.forEach(child => this.appendChild(child));
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }

    dispatch(type, event = {}) {
        const payload = {
            target: this,
            currentTarget: this,
            stopPropagation() {},
            preventDefault() {},
            ...event,
        };
        for (const listener of this.listeners.get(type) ?? []) listener(payload);
    }

    click() {
        this.dispatch('click');
    }

    getBoundingClientRect() {
        return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height };
    }
}

export class FakeDocument {
    createElement(tagName) {
        return new FakeElement(tagName);
    }

    createElementNS(_namespace, tagName) {
        return new FakeElement(tagName);
    }
}

export function descendants(root) {
    return root.children.flatMap(child => [child, ...descendants(child)]);
}

export function findByDataset(root, key, value) {
    return descendants(root).find(element => element.dataset[key] === value) ?? null;
}
