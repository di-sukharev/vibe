import type { Meta, StoryObj } from '@storybook/react-vite'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

const meta = {
  title: 'Patterns/Website',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CallToAction: Story = {
  render: () => (
    <section className="site-container py-12">
      <Card className="glow-surface overflow-hidden bg-card">
        <CardContent className="grid gap-8 p-8 md:grid-cols-[1fr_auto] md:items-center md:p-12">
          <div><Badge variant="secondary">Ready to start</Badge><h2 className="glow-text mt-4 max-w-2xl font-heading text-3xl font-bold text-balance sm:text-4xl">Turn a product idea into a working interface</h2><p className="mt-4 max-w-2xl leading-7 text-muted-foreground">Use the existing components as building blocks, then refine the composition on the real page.</p></div>
          <div className="flex flex-wrap gap-3"><Button size="lg">Get started</Button><Button size="lg" variant="outline">View components</Button></div>
        </CardContent>
      </Card>
    </section>
  ),
}

export const CardGrid: Story = {
  render: () => (
    <section className="site-container py-12"><div className="mb-8 max-w-2xl"><p className="text-sm font-bold tracking-[0.16em] text-muted-foreground uppercase">Capabilities</p><h2 className="glow-text mt-3 font-heading text-3xl font-bold">A flexible card composition</h2></div><div className="grid gap-5 md:grid-cols-3">{[['01', 'Public pages', 'Fast static pages for search and sharing.'], ['02', 'Web application', 'Focused authenticated tools and workflows.'], ['03', 'Shared backend', 'One source of truth for data and permissions.']].map(([number, title, description]) => <Card key={number}><CardHeader><Badge className="w-fit" variant="outline">{number}</Badge><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardFooter><Button variant="link" className="px-0">Learn more</Button></CardFooter></Card>)}</div></section>
  ),
}

export const FrequentlyAskedAndForm: Story = {
  render: () => (
    <section className="site-container grid gap-10 py-12 lg:grid-cols-2">
      <div><p className="text-sm font-bold tracking-[0.16em] text-muted-foreground uppercase">Questions</p><h2 className="glow-text mt-3 font-heading text-3xl font-bold">Everything you need to continue</h2><Accordion className="mt-6" type="single" collapsible defaultValue="first"><AccordionItem value="first"><AccordionTrigger>Is the site still static?</AccordionTrigger><AccordionContent>Yes. These components are composed by Astro into static HTML.</AccordionContent></AccordionItem><AccordionItem value="second"><AccordionTrigger>Can the design evolve?</AccordionTrigger><AccordionContent>Tokens and component states can be refined independently in Storybook.</AccordionContent></AccordionItem></Accordion></div>
      <Card><CardHeader><CardTitle>Request access</CardTitle><CardDescription>Leave your details and we will follow up.</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel htmlFor="website-pattern-name">Name</FieldLabel><Input id="website-pattern-name" placeholder="Your name" /></Field><Field><FieldLabel htmlFor="website-pattern-email">Email</FieldLabel><Input id="website-pattern-email" type="email" placeholder="name@example.com" /><FieldDescription>We only use this address for the requested follow-up.</FieldDescription></Field></FieldGroup></CardContent><CardFooter className="border-t"><Button className="w-full">Send request</Button></CardFooter></Card>
    </section>
  ),
}

export const ContentBlock: Story = {
  render: () => (
    <article className="site-container max-w-4xl py-12"><Badge variant="secondary">Design system</Badge><h1 className="glow-text mt-5 font-heading text-4xl font-bold tracking-tight text-balance sm:text-5xl">Build pages from small, inspectable components</h1><p className="mt-5 text-lg leading-8 text-muted-foreground">Storybook owns the isolated component states. Astro continues to own page structure, SEO content, and the final static composition.</p><Separator className="my-8" /><div className="grid gap-6 text-base leading-7 text-muted-foreground sm:grid-cols-2"><p>Keep component styling close to the component so every usage inherits the same controls, spacing, and states.</p><p>Use page-level composition only for content flow and responsive section layout.</p></div></article>
  ),
}
