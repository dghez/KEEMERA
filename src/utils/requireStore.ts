import type { Store } from '../types'

export default function requireStore(store: Store | undefined, name: string): Store {
    if (!store || !store.viewport) {
        throw new Error(`[Keemera] ${name} requires { store }. Pass it as new ${name}({ store: app.store, ... })`)
    }
    return store
}
