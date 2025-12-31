import React, { useState } from 'react';
import { useToast, Toast as ToastType } from '@/contexts/ToastContext';
import { 
  ToastCheckIcon, ToastErrorIcon, ToastWarningIcon, ToastInfoIcon, CloseIcon 
} from '@/components/ui/icons';
import './Toast.css';

const icons = {
  success: ToastCheckIcon,
  error: ToastErrorIcon,
  warning: ToastWarningIcon,
  info: ToastInfoIcon,
};

interface ToastItemProps {
  toast: ToastType;
  onClose: () => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onClose }) => {
  const [isExiting, setIsExiting] = useState(false);
  const Icon = icons[toast.type];

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExiting(true);
    setTimeout(onClose, 200);
  };

  const handleClick = () => {
    if (toast.onClick) {
      toast.onClick();
      // Close toast after action
      setIsExiting(true);
      setTimeout(onClose, 200);
    }
  };

  const isClickable = !!toast.onClick;

  return (
    <div 
      className={`toast toast--${toast.type} ${isExiting ? 'toast--exiting' : ''} ${isClickable ? 'toast--clickable' : ''}`}
      onClick={isClickable ? handleClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <div className="toast__icon">
        <Icon />
      </div>
      <div className="toast__content">
        <div className="toast__message">{toast.message}</div>
        {toast.description && (
          <div className="toast__description">{toast.description}</div>
        )}
        {toast.actionLabel && (
          <div className="toast__action-label">{toast.actionLabel}</div>
        )}
      </div>
      <button className="toast__close" onClick={handleClose}>
        <CloseIcon />
      </button>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
};

export default ToastContainer;


