import React, { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

const CursorTrail: React.FC = () => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const { isDark } = useTheme();

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY });
      setIsVisible(true);
    };

    const handleMouseLeave = () => {
      setIsVisible(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    document.body.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.body.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      className="pointer-events-none fixed z-[9999] transition-transform duration-75 ease-out"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div
        className={`w-8 h-8 rounded-full border-2 ${
          isDark 
            ? 'border-sky-400/50' 
            : 'border-sky-500/40'
        }`}
        style={{
          boxShadow: isDark 
            ? '0 0 15px rgba(56, 189, 248, 0.3)' 
            : '0 0 15px rgba(14, 165, 233, 0.2)',
        }}
      />
    </div>
  );
};

export default CursorTrail;
