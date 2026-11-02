// SPDX-License-Identifier: GPL-3.0-or-later

export class AnnotationStore {
    constructor() {
        this._annotations = [];
        this._past = [];
        this._future = [];
    }

    get items() {
        return this._annotations;
    }

    get canUndo() {
        return this._past.length > 0;
    }

    get canRedo() {
        return this._future.length > 0;
    }

    add(annotation) {
        this._annotations.push(annotation);
        this._past.push({type: 'add', annotation});
        this._future = [];
        return annotation;
    }

    clear() {
        if (this._annotations.length === 0)
            return false;

        // Keep the old list only for Undo; ordinary strokes never copy history.
        this._past.push({type: 'clear', annotations: this._annotations});
        this._annotations = [];
        this._future = [];
        return true;
    }

    undo() {
        if (!this.canUndo)
            return false;

        const action = this._past.pop();
        if (action.type === 'add')
            this._annotations.pop();
        else
            this._annotations = action.annotations;
        this._future.push(action);
        return true;
    }

    redo() {
        if (!this.canRedo)
            return false;

        const action = this._future.pop();
        if (action.type === 'add')
            this._annotations.push(action.annotation);
        else
            this._annotations = [];
        this._past.push(action);
        return true;
    }

    reset() {
        this._annotations = [];
        this._past = [];
        this._future = [];
    }
}
