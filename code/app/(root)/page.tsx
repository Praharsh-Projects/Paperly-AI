import React from "react";
import { Integrations } from "@/components/eldoraui/integrations";
import { BackgroundBeamsWithCollision } from "@/components/ui/background-beams-with-collision";
import { InteractiveHoverButton } from "@/components/eldoraui/interactivebutton";
import { ColourfulText } from "@/components/ui/colourful-text";
import Link from "next/link";

function page() {
  return (
    <BackgroundBeamsWithCollision className="min-h-screen">
      <div
        className="relative z-10 flex min-h-screen w-full flex-col items-center justify-center gap-6 px-4 py-8 lg:flex-row lg:gap-12 lg:px-10"
        id="left-and-right-comp"
      >
        <div id="left" className="flex w-full flex-col lg:w-1/2">
          <div className="px-2 py-6 sm:px-10 sm:py-10">
            <h1 className="text-4xl font-extrabold text-white sm:text-5xl">
              <ColourfulText text="Paperly" />: AI-Powered Exam Question
              Generator
            </h1>
            <p className="mt-4 text-xl text-gray-200">
              Automate the creation of customized question papers based on
              user-uploaded PDFs
            </p>
            <Link href="/chat" className="block w-full max-w-sm">
              <InteractiveHoverButton className="my-8" />
            </Link>
          </div>
        </div>
        <div id="right" className="w-full lg:w-1/2">
          <div className="relative z-10 mx-auto h-[360px] w-full overflow-hidden rounded-lg bg-background bg-opacity-100 sm:h-[500px] sm:w-[90%]">
            <Integrations />
          </div>
        </div>
      </div>
    </BackgroundBeamsWithCollision>
  );
}

export default page;
