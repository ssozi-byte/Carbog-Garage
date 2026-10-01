export const site = {
  name: 'MOTORA',
  fullName: 'MOTORA Garage',
  tagline: 'Your car. Our expertise.',
  phone: '+254 712 345 678',
  phoneHref: 'tel:+254712345678',
  whatsapp: 'https://wa.me/254712345678?text=Hi%20MOTORA%2C%20I%27d%20like%20to%20book%20a%20service.',
  email: 'service@motora.co.ke',
  location: {
    area: 'Kilimani',
    city: 'Nairobi',
    address: 'Ngong Lane Plaza, Off Ngong Road',
    maps: 'https://maps.google.com/?q=Ngong+Road+Nairobi+Kenya',
    directions: 'https://maps.google.com/?q=Ngong+Road+Nairobi+Kenya',
  },
  hours: [
    { days: 'Monday – Friday', time: '8:00 AM – 6:00 PM' },
    { days: 'Saturday', time: '8:00 AM – 4:00 PM' },
    { days: 'Sunday', time: 'Closed' },
  ],
  socials: [
    { label: 'Instagram', href: '#' },
    { label: 'Facebook', href: '#' },
    { label: 'TikTok', href: '#' },
    { label: 'YouTube', href: '#' },
  ],
}

export const nav = [
  { label: 'Home', to: '/' },
  { label: 'Services', to: '/services' },
  { label: 'About', to: '/about' },
  { label: 'Our Work', to: '/gallery' },
  { label: 'Contact', to: '/contact' },
]

export const stats = [
  { value: '10+', label: 'Years of experience' },
  { value: '2,000+', label: 'Vehicles serviced' },
  { value: '4.9★', label: 'Customer rating' },
  { value: '12', label: 'Certified technicians' },
]
