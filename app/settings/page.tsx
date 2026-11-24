import { PageBody, PageHeader } from "@/components/page-header"
import { CountrySettingsForm } from "@/components/country-settings-form"
import { SocialSettingsForm } from "@/components/social-settings-form"
import { SettingsForm } from "@/components/settings-form"
import {
  getCountrySettings,
  getSearchSettings,
  getSocialSettings,
} from "@/src/clients/settings"
import { getAppTenant } from "@/src/web/tenant"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const tenant = await getAppTenant()
  return (
    <>
      <PageHeader title="Settings" />
      <PageBody>
        <div className="mx-auto grid w-full max-w-xl gap-4">
          <SettingsForm initial={await getSearchSettings(tenant.id)} />
          <CountrySettingsForm initial={await getCountrySettings(tenant.id)} />
          <SocialSettingsForm initial={await getSocialSettings(tenant.id)} />
        </div>
      </PageBody>
    </>
  )
}
