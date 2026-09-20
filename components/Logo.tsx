import React from "react"

interface LogoProps {
    className?: string
}

export const Logo: React.FC<LogoProps> = ({ className }) => {
    return (
        <svg
            width="512"
            height="512"
            viewBox="0 0 512 512"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            <path
                d="M128 320L256 384L384 320L256 256L128 320Z"
                fill="currentColor"
                className="opacity-50"
            />
            <path
                d="M128 256L256 320L384 256L256 192L128 256Z"
                fill="currentColor"
                className="opacity-75"
            />
            <path d="M128 192L256 256L384 192L256 128L128 192Z" fill="currentColor" />
            <path
                d="M168 144L240 176L344 96"
                stroke="currentColor"
                strokeWidth="28"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}
