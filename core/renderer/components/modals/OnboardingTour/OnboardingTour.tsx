import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui';
import { RocketIcon, ChevronRightIcon, CheckIcon, CollectionsIcon, SendIcon, ResponseIcon } from '@/components/ui/icons';
import { isElectron } from '@/utils';
import './OnboardingTour.css';

interface TourStep {
  id: string;
  title: string;
  description: string;
  targetSelector: string;
  icon: React.ReactNode;
  position: 'top' | 'bottom' | 'left' | 'right';
}

const tourSteps: TourStep[] = [
  {
    id: 'sidebar',
    title: 'Collections & Navigation',
    description: 'This is your sidebar where you can organize API requests into collections. We\'ve added a sample collection to get you started—try expanding it to see example requests.',
    targetSelector: '[data-onboarding="sidebar"]',
    icon: <CollectionsIcon />,
    position: 'right',
  },
  {
    id: 'url-bar',
    title: 'Request Builder',
    description: 'Enter your API endpoint URL here, select the HTTP method, and hit Send. You can also add headers, body, and query parameters below.',
    targetSelector: '[data-onboarding="url-bar"]',
    icon: <SendIcon />,
    position: 'bottom',
  },
  {
    id: 'response',
    title: 'Response Panel',
    description: 'After sending a request, the response appears here. View the response body, headers, cookies, and timing information to debug your APIs.',
    targetSelector: '[data-onboarding="response"]',
    icon: <ResponseIcon />,
    position: 'top',
  },
];

interface SpotlightPosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipPosition {
  top: number;
  left: number;
}

interface OnboardingTourProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ forceOpen, onClose }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);
  const [spotlightPos, setSpotlightPos] = useState<SpotlightPosition | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition>({ top: 0, left: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  
  // Only show onboarding in Electron app, not web
  const isElectronApp = isElectron();

  // Handle external trigger to open onboarding
  useEffect(() => {
    if (!isElectronApp) return; // Skip in web mode
    
    if (forceOpen) {
      setShowWelcome(true);
      setCurrentStep(0);
      setIsOpen(true);
      requestAnimationFrame(() => setIsVisible(true));
    }
  }, [forceOpen, isElectronApp]);

  // Check if onboarding has been completed (only on initial mount)
  useEffect(() => {
    if (!isElectronApp) return; // Skip in web mode
    if (forceOpen) return; // Don't auto-open if externally controlled
    
    const hasCompletedOnboarding = localStorage.getItem('echolon_onboarding_completed');
    if (!hasCompletedOnboarding) {
      // Small delay to ensure app is fully rendered
      const timer = setTimeout(() => {
        setIsOpen(true);
        requestAnimationFrame(() => setIsVisible(true));
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [forceOpen, isElectronApp]);
  
  // Don't render anything in web mode
  if (!isElectronApp) return null;

  // Calculate spotlight and tooltip positions
  const updatePositions = useCallback(() => {
    if (showWelcome || currentStep >= tourSteps.length) return;

    const step = tourSteps[currentStep];
    const target = document.querySelector(step.targetSelector);
    
    if (!target) {
      console.warn(`Onboarding target not found: ${step.targetSelector}`);
      return;
    }

    const rect = target.getBoundingClientRect();
    const padding = 8;

    // Spotlight position
    setSpotlightPos({
      top: rect.top - padding,
      left: rect.left - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    });

    // Tooltip position
    const tooltipWidth = 340;
    const tooltipHeight = tooltipRef.current?.offsetHeight || 200;
    const margin = 16;
    let tooltipTop = 0;
    let tooltipLeft = 0;

    switch (step.position) {
      case 'right':
        tooltipTop = rect.top + rect.height / 2 - tooltipHeight / 2;
        tooltipLeft = rect.right + margin;
        break;
      case 'left':
        tooltipTop = rect.top + rect.height / 2 - tooltipHeight / 2;
        tooltipLeft = rect.left - tooltipWidth - margin;
        break;
      case 'bottom':
        tooltipTop = rect.bottom + margin;
        tooltipLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
      case 'top':
        tooltipTop = rect.top - tooltipHeight - margin;
        tooltipLeft = rect.left + rect.width / 2 - tooltipWidth / 2;
        break;
    }

    // Keep tooltip within viewport
    tooltipTop = Math.max(margin, Math.min(tooltipTop, window.innerHeight - tooltipHeight - margin));
    tooltipLeft = Math.max(margin, Math.min(tooltipLeft, window.innerWidth - tooltipWidth - margin));

    setTooltipPos({ top: tooltipTop, left: tooltipLeft });
  }, [currentStep, showWelcome]);

  // Update positions on step change and window resize
  useEffect(() => {
    if (!isOpen || showWelcome) return;

    updatePositions();

    // Set up resize observer for dynamic content
    const step = tourSteps[currentStep];
    const target = document.querySelector(step?.targetSelector || '');
    
    if (target && !resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver(() => {
        updatePositions();
      });
      resizeObserverRef.current.observe(target);
    }

    window.addEventListener('resize', updatePositions);
    window.addEventListener('scroll', updatePositions, true);

    return () => {
      window.removeEventListener('resize', updatePositions);
      window.removeEventListener('scroll', updatePositions, true);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, [isOpen, showWelcome, currentStep, updatePositions]);

  const handleStartTour = () => {
    setShowWelcome(false);
    setCurrentStep(0);
    // Small delay to allow the transition
    setTimeout(updatePositions, 100);
  };

  const handleNext = () => {
    if (currentStep < tourSteps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = () => {
    localStorage.setItem('echolon_onboarding_completed', 'true');
    setIsVisible(false);
    setTimeout(() => {
      setIsOpen(false);
      onClose?.();
    }, 300);
  };

  const handleSkip = () => {
    localStorage.setItem('echolon_onboarding_completed', 'true');
    setIsVisible(false);
    setTimeout(() => {
      setIsOpen(false);
      onClose?.();
    }, 300);
  };

  if (!isOpen) return null;

  const step = tourSteps[currentStep];

  return (
    <div className={`onboarding-tour ${isVisible ? 'onboarding-tour--visible' : ''}`}>
      {/* Welcome Modal */}
      {showWelcome && (
        <>
          <div className="onboarding-tour__overlay" />
          <div className="onboarding-tour__welcome">
            <div className="onboarding-tour__welcome-icon">
              <RocketIcon />
            </div>
            <h1 className="onboarding-tour__welcome-title">Welcome to Echolon</h1>
            <p className="onboarding-tour__welcome-subtitle">
              Your modern API development companion
            </p>
            <p className="onboarding-tour__welcome-description">
              Let's take a quick tour to help you get started. We'll show you the key features in just a few steps.
            </p>
            <div className="onboarding-tour__welcome-steps">
              <span className="onboarding-tour__step-count">{tourSteps.length} quick steps</span>
            </div>
            <div className="onboarding-tour__welcome-actions">
              <Button variant="ghost" onClick={handleSkip}>
                Skip Tour
              </Button>
              <Button variant="primary" onClick={handleStartTour}>
                Start Tour
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Tour Steps with Spotlight */}
      {!showWelcome && spotlightPos && (
        <>
          {/* Overlay with cutout */}
          <svg className="onboarding-tour__spotlight-svg" width="100%" height="100%">
            <defs>
              <mask id="spotlight-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                <rect
                  x={spotlightPos.left}
                  y={spotlightPos.top}
                  width={spotlightPos.width}
                  height={spotlightPos.height}
                  rx="8"
                  fill="black"
                />
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="rgba(0, 0, 0, 0.75)"
              mask="url(#spotlight-mask)"
            />
          </svg>

          {/* Spotlight border glow */}
          <div
            className="onboarding-tour__spotlight-border"
            style={{
              top: spotlightPos.top,
              left: spotlightPos.left,
              width: spotlightPos.width,
              height: spotlightPos.height,
            }}
          />

          {/* Tooltip */}
          <div
            ref={tooltipRef}
            className={`onboarding-tour__tooltip onboarding-tour__tooltip--${step.position}`}
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
          >
            <div className="onboarding-tour__tooltip-header">
              <span className="onboarding-tour__tooltip-icon">{step.icon}</span>
              <span className="onboarding-tour__tooltip-title">{step.title}</span>
            </div>
            <p className="onboarding-tour__tooltip-description">{step.description}</p>
            <div className="onboarding-tour__tooltip-footer">
              <div className="onboarding-tour__progress">
                <span className="onboarding-tour__progress-text">
                  Step {currentStep + 1} of {tourSteps.length}
                </span>
                <div className="onboarding-tour__progress-dots">
                  {tourSteps.map((_, index) => (
                    <span
                      key={index}
                      className={`onboarding-tour__progress-dot ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
                    />
                  ))}
                </div>
              </div>
              <div className="onboarding-tour__tooltip-actions">
                {currentStep > 0 && (
                  <Button variant="ghost" size="sm" onClick={handlePrev}>
                    Back
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleSkip}>
                  Skip
                </Button>
                <Button variant="primary" size="sm" onClick={handleNext}>
                  {currentStep === tourSteps.length - 1 ? (
                    <>
                      Finish
                      <CheckIcon />
                    </>
                  ) : (
                    <>
                      Next
                      <ChevronRightIcon />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default OnboardingTour;
