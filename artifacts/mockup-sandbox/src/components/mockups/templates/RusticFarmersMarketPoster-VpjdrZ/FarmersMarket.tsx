import './fonts.css';
import asset0 from "./assets/pos-18-produce.png";

import React from "react";
import { MapPin, Calendar, Clock, Leaf } from "lucide-react";

export function FarmersMarket() {
  return (
    <div
      style={{ width: "100%", height: "100%" }}
      className="relative overflow-hidden bg-[#Fdfbf7] text-[#2c3e2e] flex flex-col items-center justify-between p-12 border-8 border-[#3b5240]"
    >
      {/* Texture overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-multiply" 
           style={{ backgroundImage: 'url("https://www.transparenttextures.com/patterns/paper-fibers.png")' }}></div>

      {/* Top Banner */}
      <div className="w-full text-center space-y-2 z-10 pt-4">
        <p className="font-['Space_Mono'] uppercase tracking-[0.3em] text-sm text-[#5f7a61]">Est. 2012</p>
        <div className="flex items-center justify-center gap-4">
          <div className="h-[1px] bg-[#3b5240] w-16"></div>
          <p className="font-['Playfair_Display'] italic text-xl text-[#3b5240]">Support Local</p>
          <div className="h-[1px] bg-[#3b5240] w-16"></div>
        </div>
      </div>

      {/* Main Title */}
      <div className="text-center z-10 w-full px-8">
        <h1 className="font-['Playfair_Display'] text-7xl font-bold uppercase tracking-wide leading-[0.9] text-[#2c3e2e] mb-4">
          Oakhaven<br />
          <span className="text-6xl text-[#3b5240]">Farmers</span><br />
          Market
        </h1>
        <p className="font-['Playfair_Display'] italic text-2xl text-[#8b5a33] mt-2">Fresh • Organic • Hand-crafted</p>
      </div>

      {/* Illustration */}
      <div className="relative w-full h-[320px] flex items-center justify-center z-10 my-4">
        {/* Background circle behind produce */}
        <div className="absolute w-[300px] h-[300px] rounded-full bg-[#f4ebd9] opacity-60"></div>
        <img 
          src={asset0} 
          alt="Fresh produce illustration" 
          className="relative w-[340px] h-[340px] object-cover mix-blend-multiply"
        />
        
        {/* Decorative elements */}
        <Leaf className="absolute top-10 left-20 w-8 h-8 text-[#5f7a61] opacity-50 -rotate-45" />
        <Leaf className="absolute bottom-10 right-20 w-10 h-10 text-[#5f7a61] opacity-50 rotate-12" />
      </div>

      {/* Details Section */}
      <div className="w-full grid grid-cols-2 gap-8 z-10 border-t-2 border-b-2 border-[#3b5240] py-6 my-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <Calendar className="w-8 h-8 text-[#8b5a33]" />
          <div>
            <h3 className="font-['Space_Mono'] uppercase tracking-widest text-sm font-bold text-[#3b5240] mb-1">Every Sunday</h3>
            <p className="font-['Playfair_Display'] text-lg">May through October</p>
          </div>
        </div>
        <div className="flex flex-col items-center text-center space-y-3">
          <Clock className="w-8 h-8 text-[#8b5a33]" />
          <div>
            <h3 className="font-['Space_Mono'] uppercase tracking-widest text-sm font-bold text-[#3b5240] mb-1">Market Hours</h3>
            <p className="font-['Playfair_Display'] text-lg">8:00 AM — 1:00 PM</p>
          </div>
        </div>
      </div>

      {/* Location */}
      <div className="w-full text-center z-10 pb-4">
        <div className="flex items-center justify-center gap-2 mb-2">
          <MapPin className="w-5 h-5 text-[#8b5a33]" />
          <h3 className="font-['Space_Mono'] uppercase tracking-widest font-bold text-[#3b5240]">Historic Town Square</h3>
        </div>
        <p className="font-['Playfair_Display'] text-xl">100 Main Street, Oakhaven Valley</p>
      </div>

      {/* Footer */}
      <div className="w-full text-center z-10 pt-6">
        <p className="font-['Space_Mono'] uppercase tracking-widest text-xs text-[#5f7a61]">
          Live Music • Artisan Goods • Family Friendly
        </p>
      </div>
    </div>
  );
}
