import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import {
	formatCurrency,
	formatList,
	formatNumber,
} from "@superset/i18n/format";
import {
	gbHourPackPricePerGbHour,
	maxYearlyDiscount,
	offersYearlyDiscount,
	PLAN_PRICE_CURRENCY,
	type PlanFamily,
	seatPricePerMonth,
} from "@superset/shared/billing";

export interface FamilyPriceSet {
	family: string;
	name: string;
	monthly: string;
	yearly: string;
	yearlyTotal: string | null;
	hasYearlyDiscount: boolean;
	gbHours: string | null;
	multiple: string | null;
	overage: string | null;
	overageRate: string | null;
	environments: string | null;
	pack: string | null;
	previousName: string | null;
	baseName: string;
}

export interface PlanPriceValues {
	families: FamilyPriceSet[];
	byFamily: Record<string, FamilyPriceSet>;
	maxDiscount: string | null;
	fromPrice: string | null;
	planPrices: string;
	allowances: string;
	overagePrice: string | null;
	packPrice: string | null;
}

const YEARLY_PRICE_ITEM = msg({
	message: "{name}: {monthly} per user/month, or {yearly} billed yearly",
});
const MONTHLY_PRICE_ITEM = msg({
	message: "{name}: {monthly} per user/month",
});
const ALLOWANCE_ITEM = msg({ message: "{gbHours} on {name}" });
const PACK_ITEM = msg({ message: "{price} per GB-hour" });

export function planPriceValues(
	catalog: PlanFamily[],
	i18n: I18n,
): PlanPriceValues {
	const locale = i18n.locale;
	const currency = (value: number) =>
		formatCurrency(
			value,
			PLAN_PRICE_CURRENCY,
			{ minimumFractionDigits: 0, maximumFractionDigits: 2 },
			locale,
		);
	const number = (value: number, digits: number) =>
		formatNumber(value, { maximumFractionDigits: digits }, locale);
	const base = catalog.find((family) => family.gbMinutesPerSeat);
	const firstPack = catalog.find((family) => family.pack)?.pack;
	const perGbHour = (value: number) =>
		i18n._({ ...PACK_ITEM, values: { price: currency(value) } });
	const families = catalog.map((family, index): FamilyPriceSet => {
		const hasYearlyDiscount = offersYearlyDiscount(family);
		return {
			family: family.family,
			name: family.name,
			monthly: currency(seatPricePerMonth(family, false)),
			yearly: currency(seatPricePerMonth(family, true)),
			yearlyTotal:
				hasYearlyDiscount && family.yearly
					? currency(family.yearly.seatPrice)
					: null,
			hasYearlyDiscount,
			gbHours: family.gbMinutesPerSeat
				? number(family.gbMinutesPerSeat / 60, 0)
				: null,
			multiple:
				family !== base && family.gbMinutesPerSeat && base?.gbMinutesPerSeat
					? number(family.gbMinutesPerSeat / base.gbMinutesPerSeat, 1)
					: null,
			overage:
				family.overagePerGbHour == null
					? null
					: currency(family.overagePerGbHour),
			overageRate:
				family.gbMinutesPerSeat && family.overagePerGbHour != null
					? perGbHour(family.overagePerGbHour)
					: null,
			environments: family.environments ? number(family.environments, 0) : null,
			pack: family.pack
				? perGbHour(gbHourPackPricePerGbHour(family.pack))
				: null,
			previousName: catalog[index - 1]?.name ?? null,
			baseName: base?.name ?? family.name,
		};
	});
	const discount = maxYearlyDiscount(catalog);
	const cheapest = Math.min(
		...catalog.map((family) => seatPricePerMonth(family, true)),
	);
	return {
		families,
		byFamily: Object.fromEntries(families.map((set) => [set.family, set])),
		maxDiscount:
			discount > 0
				? formatNumber(
						discount,
						{ style: "percent", maximumFractionDigits: 0 },
						locale,
					)
				: null,
		fromPrice: Number.isFinite(cheapest) ? currency(cheapest) : null,
		planPrices: formatList(
			families.map((set) =>
				i18n._({
					...(set.hasYearlyDiscount ? YEARLY_PRICE_ITEM : MONTHLY_PRICE_ITEM),
					values: { name: set.name, monthly: set.monthly, yearly: set.yearly },
				}),
			),
			{ type: "conjunction" },
			locale,
		),
		allowances: formatList(
			families
				.filter((set) => set.gbHours)
				.map((set) =>
					i18n._({
						...ALLOWANCE_ITEM,
						values: { gbHours: set.gbHours, name: set.name },
					}),
				),
			{ type: "conjunction" },
			locale,
		),
		overagePrice:
			families.find((set) => set.gbHours)?.overage ??
			families[0]?.overage ??
			null,
		packPrice: firstPack ? currency(gbHourPackPricePerGbHour(firstPack)) : null,
	};
}

export function featureValues(set: FamilyPriceSet | undefined) {
	return {
		gbHours: set?.gbHours ?? "",
		overage: set?.gbHours ? (set.overage ?? "") : "",
		multiple: set?.multiple ?? "",
		pack: set?.pack ?? "",
		previousPlan: set?.previousName ?? "",
		basePlan: set?.baseName ?? "",
	};
}

/** A feature that depends on cloud values shows only when the plan has them. */
export function featureShown(
	feature: { needs?: "gbHours" | "overage" | "multiple" | "pack" },
	set: FamilyPriceSet | undefined,
): boolean {
	return !feature.needs || Boolean(featureValues(set)[feature.needs]);
}

export function faqValues(values: PlanPriceValues) {
	return {
		planPrices: values.planPrices,
		allowances: values.allowances,
		overagePrice: values.overagePrice,
		packPrice: values.packPrice,
	};
}

export function faqShown(
	item: { needs?: "prices" | "gbHours" | "pack" },
	values: PlanPriceValues,
): boolean {
	if (!item.needs) return true;
	const needed = {
		prices: values.planPrices,
		gbHours: values.allowances,
		pack: values.packPrice,
	}[item.needs];
	return Boolean(needed);
}
