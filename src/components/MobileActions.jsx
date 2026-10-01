import icons from './Icons.jsx'
import { useContentOrStatic } from '../api/ContentProvider.jsx'

export default function MobileActions() {
  const { garage } = useContentOrStatic()
  return (
    <nav className="mobile-actions" aria-label="Quick contact">
      <a className="wa" href={garage.whatsapp} target="_blank" rel="noreferrer">
        {icons.whatsapp(17)}
        WhatsApp
      </a>
      <a href={garage.phoneHref}>
        {icons.phone(17)}
        Call
      </a>
      <a href={garage.location.directions} target="_blank" rel="noreferrer">
        {icons.pin(17)}
        Directions
      </a>
    </nav>
  )
}
