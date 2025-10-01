import './AppFooter.css';

interface AppFooterProps {
  className?: string;
  variant?: 'default' | 'dark';
}

export default function AppFooter({ className, variant = 'default' }: AppFooterProps) {
  const classes = ['app-footer'];

  if (variant === 'dark') {
    classes.push('app-footer--dark');
  }

  if (className) {
    classes.push(className);
  }

  return <footer className={classes.join(' ')}>© 32. PTO Severka a Ševa</footer>;
}
