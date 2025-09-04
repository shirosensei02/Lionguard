import { Settings } from 'lucide-react';

function Setting({ size, onClick }: { size: number, onClick?: () => void }) {
    const handleClick = () => {
        if (onClick) {
            onClick();
        }
    }

    return (
        <button onClick={handleClick}>
            <Settings className="setting" size={size} />
        </button>
    )
}

export { Setting };