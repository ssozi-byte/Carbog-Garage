import Hero from '../components/Hero.jsx'
import TrustBar from '../components/TrustBar.jsx'
import About from '../components/About.jsx'
import Services from '../components/Services.jsx'
import WorkShowcase from '../components/WorkShowcase.jsx'
import BrandStrip from '../components/BrandStrip.jsx'
import WhyChooseUs from '../components/WhyChooseUs.jsx'
import HowItWorks from '../components/HowItWorks.jsx'
import Testimonials from '../components/Testimonials.jsx'
import BookingCTA from '../components/BookingCTA.jsx'
import Location from '../components/Location.jsx'

export default function Home() {
  return (
    <>
      <Hero />
      <TrustBar />
      <About />
      <Services />
      <WorkShowcase />
      <BrandStrip />
      <WhyChooseUs />
      <HowItWorks />
      <Testimonials />
      <BookingCTA />
      <Location />
    </>
  )
}
