import { Component, type ReactNode } from 'react'

interface Props {
    children: ReactNode
}
interface State {
    error: Error | null
}

// Catches render errors so a single bad component can't blank the whole app.
export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error) {
        console.error('scribe crashed:', error)
    }

    render() {
        if (this.state.error) {
            return (
                <div className="crash">
                    <div className="crash__box">
                        <h1 className="crash__title">Something broke</h1>
                        <p className="crash__msg">{this.state.error.message}</p>
                        <button className="btn btn--promote" type="button" onClick={() => location.reload()}>
                            reload
                        </button>
                    </div>
                </div>
            )
        }
        return this.props.children
    }
}
