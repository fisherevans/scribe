import { useLayoutEffect, useRef } from 'react'

interface Props {
    value: string
    onChange: (value: string) => void
    className?: string
    placeholder?: string
}

// A textarea that starts one line tall and grows to fit its content, so it reads
// as part of the document rather than a fixed box with empty trailing lines.
export function AutoTextarea({ value, onChange, className, placeholder }: Props) {
    const ref = useRef<HTMLTextAreaElement>(null)
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = el.scrollHeight + 'px'
    }, [value])
    return (
        <textarea
            ref={ref}
            rows={1}
            className={className}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
        />
    )
}
