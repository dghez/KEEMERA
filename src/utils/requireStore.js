export default function requireStore(store, name) {
    if (!store || !store.viewport) {
        throw new Error(`[Keemera] ${name} requires { store }. Pass it as new ${name}({ store: app.store, ... })`)
    }
    return store
}
