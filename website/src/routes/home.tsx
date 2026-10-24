import AudienceSection from '@/components/landing/AudienceSection'
import CtaSection from '@/components/landing/CtaSection'
import FaqSection from '@/components/landing/FaqSection'
import FeatureGrid from '@/components/landing/FeatureGrid'
import HeroSection from '@/components/landing/HeroSection'
import LaunchKitSection from '@/components/landing/LaunchKitSection'
import ProcessSection from '@/components/landing/ProcessSection'
import ProofSection from '@/components/landing/ProofSection'
import ScenariosSection from '@/components/landing/ScenariosSection'
import SiteFooter from '@/components/landing/SiteFooter'
import SiteHeader from '@/components/landing/SiteHeader'
import { getSecondaryAction, TEMPLATE_ACTION } from '@/lib/landing-actions'

const title = 'ЙЙ — шаблон для создания сайтов и приложений с ИИ'
const description =
  'Соберите лендинг, веб- или мобильное приложение с ИИ. Технологии, структура проекта, компоненты и проверки уже настроены.'
const publicWebsiteUrl = import.meta.env.VITE_WEBSITE_URL
const publicWebappUrl = import.meta.env.VITE_WEBAPP_URL
const canonicalUrl = publicWebsiteUrl
  ? new URL('/', publicWebsiteUrl).toString()
  : undefined
const secondaryAction = getSecondaryAction(publicWebappUrl)

export default function Home() {
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
      <meta name="twitter:card" content="summary" />
      <SiteHeader
        primaryHref={TEMPLATE_ACTION.href}
        primaryLabel={TEMPLATE_ACTION.label}
      />
      <main id="main-content">
        <HeroSection
          primaryHref={TEMPLATE_ACTION.href}
          primaryLabel={TEMPLATE_ACTION.label}
          secondaryHref={secondaryAction.href}
          secondaryLabel={secondaryAction.label}
        />
        <FeatureGrid />
        <AudienceSection />
        <LaunchKitSection />
        <ProcessSection />
        <ScenariosSection />
        <ProofSection />
        <FaqSection />
        <CtaSection
          primaryHref={TEMPLATE_ACTION.href}
          primaryLabel={TEMPLATE_ACTION.label}
        />
      </main>
      <SiteFooter />
    </>
  )
}
